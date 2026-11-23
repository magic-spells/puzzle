package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/magic-spells/puzzle/compiler/internal/build"
	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/fsutil"
	"github.com/magic-spells/puzzle/compiler/internal/styles"
	"github.com/magic-spells/puzzle/compiler/internal/ui"
	"github.com/spf13/cobra"
)

var doctorCmd = &cobra.Command{
	Use:   "doctor [dir]",
	Short: "Check the project and toolchain for common problems",
	Long: `Run a set of environment and project-layout checks and print a ✓/✘
line per check. Exits non-zero if any check fails. Warnings (e.g. a missing
runtime install) are reported but do not fail the command.

With --json, print the results as one JSON object on stdout instead: dir, ok
(true when nothing failed), failures (the count), and checks — an array of
{name, status, detail} with status "pass", "fail" or "warn". The exit code is
the same either way.`,
	Args: cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		dir := dirArg(args)
		var fails int
		if asJSON, _ := cmd.Flags().GetBool("json"); asJSON {
			var err error
			if fails, err = runDoctorJSON(os.Stdout, dir); err != nil {
				return err
			}
		} else {
			fails = runDoctor(os.Stdout, ui.New(os.Stdout), dir)
		}
		if fails > 0 {
			return fmt.Errorf("doctor: %d check(s) failed", fails)
		}
		return nil
	},
}

func init() {
	doctorCmd.Flags().Bool("json", false, "Print the results as one JSON object (keys: dir, ok, failures, checks[{name, status, detail}])")
	rootCmd.AddCommand(doctorCmd)
}

// Doctor check statuses — also the --json "status" values.
const (
	doctorPass = "pass"
	doctorFail = "fail"
	doctorWarn = "warn"
)

// doctorCheck is one result line. The json tags are a public contract for
// scripts reading `puzzle doctor --json`: add keys, never rename or drop one.
type doctorCheck struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

// doctorReport is the --json shape of `puzzle doctor`.
type doctorReport struct {
	Dir      string        `json:"dir"`
	OK       bool          `json:"ok"`
	Failures int           `json:"failures"`
	Checks   []doctorCheck `json:"checks"`
}

// runDoctor runs the checks against dir, prints a line each, and returns the
// number of hard failures (warnings excluded).
func runDoctor(w io.Writer, out *ui.Printer, dir string) int {
	fmt.Fprintf(w, "\n  %s %s\n\n", out.Cyan(out.Bold("puzzle doctor")), out.Dim("· "+dir))

	checks := doctorChecks(dir)
	fails := 0
	for _, c := range checks {
		var mark, detail string
		switch c.Status {
		case doctorPass:
			mark, detail = out.Green("✓"), out.Dim(c.Detail)
		case doctorFail:
			fails++
			mark, detail = out.Red("✘"), c.Detail
		default:
			mark, detail = out.Yellow("!"), out.Dim(c.Detail)
		}
		// a detail's later lines start under its first
		fmt.Fprintf(w, "  %s %-20s  %s\n", mark, c.Name, strings.ReplaceAll(detail, "\n", "\n"+strings.Repeat(" ", 24)))
	}

	fmt.Fprintln(w)
	if fails == 0 {
		fmt.Fprintf(w, "  %s all checks passed\n", out.Green("✓"))
	} else {
		fmt.Fprintf(w, "  %s %d check(s) failed\n", out.Red("✘"), fails)
	}
	return fails
}

// runDoctorJSON runs the same checks and prints them as a doctorReport, returning
// the failure count so the command exits exactly as the table form does.
func runDoctorJSON(w io.Writer, dir string) (int, error) {
	report := doctorReport{Dir: dir, Checks: doctorChecks(dir)}
	for _, c := range report.Checks {
		if c.Status == doctorFail {
			report.Failures++
		}
	}
	report.OK = report.Failures == 0
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return report.Failures, enc.Encode(report)
}

// doctorChecks runs every check against dir and returns the results in display
// order. It prints nothing; runDoctor and runDoctorJSON render it.
func doctorChecks(dir string) []doctorCheck {
	var checks []doctorCheck
	add := func(status, label, detail string) {
		checks = append(checks, doctorCheck{Name: label, Status: status, Detail: detail})
	}
	pass := func(label, detail string) { add(doctorPass, label, detail) }
	fail := func(label, detail string) { add(doctorFail, label, detail) }
	warn := func(label, detail string) { add(doctorWarn, label, detail) }

	// node on PATH, at the floor or later.
	if ver, ok := nodeVersion(); !ok {
		fail("node", "not found on PATH — install Node.js")
	} else if nodeMajor(ver) < minNodeMajor {
		fail("node", fmt.Sprintf("%s — Puzzle needs Node %d or later", ver, minNodeMajor))
	} else {
		pass("node", ver)
	}

	// Entry point — the one path build.Build strictly requires, resolved by the
	// same rule the build uses (app/app.ts, else app/app.js; never both).
	if entry, err := build.ResolveEntry(dir); err == nil {
		rel := build.EntryJS
		if strings.HasSuffix(entry, ".ts") {
			rel = build.EntryTS
		}
		pass("entry", rel)
	} else if fsFileExists(filepath.Join(dir, filepath.FromSlash(build.EntryTS))) {
		fail("entry", "app/app.ts and app/app.js both exist — keep one")
	} else {
		fail("entry", "missing — expected app/app.ts or app/app.js")
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

	// Runtime package: the env override, the in-repo runtime, or the installed
	// package — reported in the same precedence configureRuntime uses. The
	// override is called out by name because it is invisible otherwise: a
	// build against a checkout you forgot you named looks exactly like a normal
	// one. An installed package that does not pair with this CLI fails with the
	// message build and dev stop on; a missing one is only a warning.
	installed := build.FindInstalledRuntime(dir)
	switch {
	case os.Getenv(build.RuntimeEnvVar) != "":
		pass("runtime package", build.RuntimeEnvVar+"="+os.Getenv(build.RuntimeEnvVar))
	case build.FindRuntime(dir) != "":
		pass("runtime package", "@magic-spells/puzzle (in-repo runtime)")
	case installed != "":
		if v, err := build.InstalledVersion(installed); err != nil {
			fail("runtime package", err.Error())
		} else {
			pass("runtime package", "@magic-spells/puzzle "+v+" installed")
		}
	default:
		warn("runtime package", "@magic-spells/puzzle not installed — run npm install")
	}
	return checks
}

// minNodeMajor is Puzzle's Node floor (D200); every `engines` field declares it.
const minNodeMajor = 24

// nodeMajor reads the major from `node --version` output; anything else reads
// as 0, below the floor.
func nodeMajor(ver string) (major int) {
	fmt.Sscanf(ver, "v%d", &major)
	return major
}

// nodeVersion returns `node --version` output (e.g. "v24.11.0") when node is on
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

// Keep the command package's established helper name for its other commands and
// tests while sharing the one filesystem implementation.
var fsFileExists = fsutil.FileExists
