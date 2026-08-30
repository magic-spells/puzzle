package check

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

const missingTypeScriptMessage = "puzzle check needs TypeScript: npm install -D typescript"

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
	tsc, err := resolveTSC(root)
	if err != nil {
		return 0, err
	}
	result, err := Generate(root)
	if err != nil {
		return 0, err
	}

	args := []string{"--noEmit", "--pretty", "false", "-p", filepath.Join(".puzzle", "check")}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmdArgs := append([]string{"/d", "/s", "/c", tsc}, args...)
		cmd = exec.Command("cmd.exe", cmdArgs...)
	} else {
		cmd = exec.Command(tsc, args...)
	}
	cmd.Dir = root
	output, runErr := cmd.CombinedOutput()
	if runErr == nil {
		return result.Files, emitDiagnosticsError(result)
	}
	var exitErr *exec.ExitError
	if !errors.As(runErr, &exitErr) {
		return result.Files, fmt.Errorf("run TypeScript: %w", runErr)
	}

	tables, err := LoadSegmentTables(root, result.Dir)
	if err != nil {
		return result.Files, err
	}
	formatted := strings.TrimSuffix(remapTSCOutput(root, string(output), tables), "\n")
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

func emitDiagnosticsError(result *Result) error {
	if len(result.Diagnostics) == 0 {
		return nil
	}
	return errors.New(strings.Join(result.Diagnostics, "\n"))
}

func resolveTSC(appRoot string) (string, error) {
	name := "tsc"
	if runtime.GOOS == "windows" {
		name = "tsc.cmd"
	}
	path := filepath.Join(appRoot, "node_modules", ".bin", name)
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return "", errors.New(missingTypeScriptMessage)
	}
	return path, nil
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
