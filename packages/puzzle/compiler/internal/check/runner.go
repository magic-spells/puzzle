package check

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const missingTypeScriptMessage = "puzzle check needs TypeScript: npm install -D typescript"

const minTypeScriptMajor = 7

const oldTypeScriptMessage = "puzzle check needs TypeScript 7 or later, found %s: npm install -D typescript@latest"

const missingNodeMessage = "puzzle check needs Node.js on PATH: it runs the app's TypeScript compiler"

var tscDiagnosticRE = regexp.MustCompile(`^(.+)\(([0-9]+),([0-9]+)\): error TS[0-9]+: (.*)$`)

// Run regenerates the virtual workspace and invokes the app-local TypeScript
// compiler, returning the number of .pzl files checked. A TypeScript diagnostic
// failure is returned as already-formatted text so the CLI's ordinary error path
// prints it once and exits non-zero.
func Run(appRoot string) (int, error) {
	root, err := filepath.Abs(appRoot)
	if err != nil {
		return 0, err
	}
	// "You are not in a Puzzle project" is checked before "TypeScript is not
	// installed": a wrong working directory would otherwise be reported as a
	// missing dependency.
	if _, err := sourceDir(root); err != nil {
		return 0, err
	}
	tool, err := resolveTSC(root)
	if err != nil {
		return 0, err
	}
	if err := requireTypeScript7(tool); err != nil {
		return 0, err
	}
	result, err := Generate(root)
	if err != nil {
		return 0, err
	}

	args := []string{"--noEmit", "--pretty", "false", "-p", filepath.Join(".puzzle", "check")}
	cmd := tool.command(args...)
	cmd.Dir = root
	output, runErr := cmd.CombinedOutput()
	if runErr == nil {
		return result.Files, emitDiagnosticsError(result)
	}
	var exitErr *exec.ExitError
	if !errors.As(runErr, &exitErr) {
		return result.Files, fmt.Errorf("run TypeScript: %w", runErr)
	}

	formatted := strings.TrimSuffix(remapTSCOutput(root, string(output), result.tableIndex(root)), "\n")
	// A .pzl that failed to compile is reported alongside the type errors: it is
	// a real failure of this run, and it is the reason the file is absent from
	// everything tsc just checked.
	if len(result.Diagnostics) > 0 {
		formatted = strings.TrimSuffix(strings.Join(result.Diagnostics, "\n")+"\n"+formatted, "\n")
	}
	if strings.TrimSpace(formatted) == "" {
		return result.Files, fmt.Errorf("TypeScript exited with status %d", exitErr.ExitCode())
	}
	return result.Files, errors.New(formatted)
}

// requireTypeScript7 enforces the floor: puzzle check writes a config only
// TypeScript 7 and later accept (no baseUrl, no node10 resolution), so an
// older compiler is stopped before it reports that config as broken.
func requireTypeScript7(tool tscTool) error {
	output, err := tool.command("--version").CombinedOutput()
	if err != nil {
		return fmt.Errorf("read TypeScript version: %w", err)
	}
	return checkTypeScriptVersion(string(output))
}

// checkTypeScriptVersion reads `tsc --version` output, `Version 7.0.2` (a
// prerelease suffix such as `7.1.0-beta` included), and rejects a major below 7.
func checkTypeScriptVersion(output string) error {
	output = strings.TrimSpace(output)
	var major, minor int
	if _, err := fmt.Sscanf(output, "Version %d.%d", &major, &minor); err != nil {
		return fmt.Errorf("read TypeScript version: unexpected output %q", output)
	}
	if major < minTypeScriptMajor {
		return fmt.Errorf(oldTypeScriptMessage, strings.TrimPrefix(output, "Version "))
	}
	return nil
}

// tscTool is the app's TypeScript compiler entry point plus the node binary that
// runs it. tsc is a plain JavaScript file, so `node <entry> args…` is the same
// invocation on every OS. The `.bin` shims are deliberately not used: the
// Windows one is a `tsc.cmd` batch file that has to go through `cmd.exe /s`,
// which strips the quotes Go put around a path containing a space and runs
// `C:\Users\Cory` instead of the compiler (D165).
type tscTool struct {
	node  string
	entry string
}

func (t tscTool) command(args ...string) *exec.Cmd {
	return exec.Command(t.node, append([]string{t.entry}, args...)...)
}

func emitDiagnosticsError(result *Result) error {
	if len(result.Diagnostics) == 0 {
		return nil
	}
	return errors.New(strings.Join(result.Diagnostics, "\n"))
}

// resolveTSC finds the app's own TypeScript compiler. It targets the package's
// own `bin/tsc` entry — what every `.bin` shim points at, under npm, pnpm, and
// yarn layouts alike — rather than the shim, so the command never depends on a
// platform shell.
func resolveTSC(appRoot string) (tscTool, error) {
	entry := filepath.Join(appRoot, "node_modules", "typescript", "bin", "tsc")
	info, err := os.Stat(entry)
	if err != nil || info.IsDir() {
		return tscTool{}, errors.New(missingTypeScriptMessage)
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return tscTool{}, errors.New(missingNodeMessage)
	}
	return tscTool{node: node, entry: entry}, nil
}

func remapTSCOutput(appRoot, output string, tables map[string]*SegmentTable) string {
	if output == "" {
		return ""
	}
	trailingNewline := strings.HasSuffix(output, "\n")
	lines := strings.Split(strings.TrimSuffix(output, "\n"), "\n")
	for i, line := range lines {
		line = strings.TrimSuffix(line, "\r")
		match := tscDiagnosticRE.FindStringSubmatch(line)
		if match == nil {
			lines[i] = line
			continue
		}
		lineNo, lineErr := strconv.Atoi(match[2])
		colNo, colErr := strconv.Atoi(match[3])
		if lineErr != nil || colErr != nil {
			lines[i] = line
			continue
		}
		path := match[1]
		if !filepath.IsAbs(path) {
			path = filepath.Join(appRoot, filepath.FromSlash(path))
		}
		table := tables[filepath.Clean(path)]
		if table == nil {
			lines[i] = line
			continue
		}
		pos, ok := table.Remap(lineNo, colNo)
		if !ok {
			lines[i] = line
			continue
		}
		lines[i] = fmt.Sprintf("%s:%d:%d: %s", table.Source, pos.Line, pos.Column, match[4])
	}
	formatted := strings.Join(lines, "\n")
	if trailingNewline {
		formatted += "\n"
	}
	return formatted
}
