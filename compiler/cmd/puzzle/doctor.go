package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/styles"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/spf13/cobra"
)

var doctorCmd = &cobra.Command{
	Use:   "doctor [dir]",
	Short: "Check the project and toolchain for common problems",
	Long: `Run a set of environment and project-layout checks and print a ✓/✘
line per check. Exits non-zero if any check fails. Warnings (e.g. a missing
runtime install) are reported but do not fail the command.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := "."
		if len(args) == 1 {
			dir = args[0]
		}
		out := ui.New(os.Stdout)
		if fails := runDoctor(os.Stdout, out, dir); fails > 0 {
			return fmt.Errorf("doctor: %d check(s) failed", fails)
		}
		return nil
	},
}

func init() {
	rootCmd.AddCommand(doctorCmd)
}

// runDoctor runs the checks against dir, prints a line each, and returns the
// number of hard failures (warnings excluded).
func runDoctor(w io.Writer, out *ui.Printer, dir string) int {
	fmt.Fprintf(w, "\n  %s %s\n\n", out.Cyan(out.Bold("puzzle doctor")), out.Dim("· "+dir))

	fails := 0
	line := func(mark, label, detail string) {
		fmt.Fprintf(w, "  %s %s  %s\n", mark, fmt.Sprintf("%-20s", label), detail)
	}
	pass := func(label, detail string) { line(out.Green("✓"), label, out.Dim(detail)) }
	fail := func(label, detail string) { fails++; line(out.Red("✘"), label, detail) }
	warn := func(label, detail string) { line(out.Yellow("!"), label, out.Dim(detail)) }

	// node on PATH.
	if ver, ok := nodeVersion(); ok {
		pass("node", ver)
	} else {
		fail("node", "not found on PATH — install Node.js")
	}

	// Entry point — the one path build.Build strictly requires.
	if fsFileExists(filepath.Join(dir, "app", "app.js")) {
		pass("entry (app/app.js)", "found")
	} else {
		fail("entry (app/app.js)", "missing — expected app/app.js")
	}

	// index.html — build copies from app/public/ (falling back to a flat public/).
	switch {
	case fsFileExists(filepath.Join(dir, "app", "public", "index.html")):
		pass("index.html", "app/public/index.html")
	case fsFileExists(filepath.Join(dir, "public", "index.html")):
		pass("index.html", "public/index.html")
	default:
		fail("index.html", "missing — expected app/public/index.html")
	}

	// puzzle.config.js — absent is fine; present must load without error.
	var cfg config.Config
	cfgPath := filepath.Join(dir, config.ConfigFileName)
	if !fsFileExists(cfgPath) {
		pass("puzzle.config.js", "none (defaults)")
	} else if c, err := config.LoadConfig(dir); err != nil {
		fail("puzzle.config.js", strings.TrimSpace(err.Error()))
	} else {
		cfg = c
		pass("puzzle.config.js", "loaded")
	}

	// Tailwind CLI — only when the config declares it. ResolveCLI always offers
	// an npx fallback (styles.resolveCLIs appends the npx candidates
	// unconditionally), so it never fails to resolve; a resolution that lands on
	// npx means no local install.
	if cfg.TailwindEnabled() {
		cli, _ := styles.ResolveCLI(dir)
		if cli.Exec == "npx" {
			warn("tailwind cli", "no local install — will fall back to "+cli.Name)
		} else {
			pass("tailwind cli", cli.Name)
		}
	}

	// Runtime package (warning): the installed package, or the in-repo fallback.
	switch {
	case findInstalledRuntime(dir) != "":
		pass("runtime package", "@magic-spells/puzzle installed")
	case findRepoRuntime(dir) != "":
		pass("runtime package", "@magic-spells/puzzle (in-repo runtime)")
	default:
		warn("runtime package", "@magic-spells/puzzle not installed — run npm install")
	}

	fmt.Fprintln(w)
	if fails == 0 {
		fmt.Fprintf(w, "  %s all checks passed\n", out.Green("✓"))
	} else {
		fmt.Fprintf(w, "  %s %d check(s) failed\n", out.Red("✘"), fails)
	}
	return fails
}

// nodeVersion returns `node --version` output (e.g. "v20.11.0") when node is on
// PATH and runnable.
func nodeVersion() (string, bool) {
	path, err := exec.LookPath("node")
	if err != nil {
		return "", false
	}
	out, err := exec.Command(path, "--version").Output()
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(out)), true
}

// findInstalledRuntime mirrors build.findInstalledRuntime: walk up for
// node_modules/@magic-spells/puzzle/client-runtime/index.js.
func findInstalledRuntime(start string) string {
	dir, err := filepath.Abs(start)
	if err != nil {
		dir = start
	}
	for {
		idx := filepath.Join(dir, "node_modules", "@magic-spells", "puzzle", "client-runtime", "index.js")
		if fsFileExists(idx) {
			return idx
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// findRepoRuntime mirrors build.findRuntime: the in-repo runtime is a directory
// holding client-runtime/index.js whose package.json is "@magic-spells/puzzle".
func findRepoRuntime(start string) string {
	dir, err := filepath.Abs(start)
	if err != nil {
		dir = start
	}
	for {
		idx := filepath.Join(dir, "client-runtime", "index.js")
		if fsFileExists(idx) && pkgIsPuzzle(filepath.Join(dir, "package.json")) {
			return idx
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func pkgIsPuzzle(pkgPath string) bool {
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return false
	}
	var pkg struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return false
	}
	return pkg.Name == "@magic-spells/puzzle"
}

// fsFileExists reports whether path is an existing regular file.
func fsFileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
