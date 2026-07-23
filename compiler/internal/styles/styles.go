// Package styles owns the CSS side of a build: running the Tailwind pipeline
// (constellation/doc/DOC-DECISIONS.md D12/D26) and composing the final dist/styles.css.
//
// Composition (SPEC §3): the final stylesheet is the Tailwind output (when the
// pipeline is enabled) followed by the collected <style> blocks. index.html
// links a single /styles.css, so both layers must land in one file with the
// Tailwind utilities first and hand-written global CSS appended after.
//
// The Tailwind invocation is behind the Runner interface so builds can be
// exercised without the real toolchain (unit tests inject a fake), while the
// production path shells out to the Tailwind CLI via npx.
package styles

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Runner produces the Tailwind CSS layer for an app. The real implementation
// (NpxRunner) shells out to the Tailwind CLI; tests use a fake.
type Runner interface {
	// Run generates and returns the Tailwind CSS as a string. A non-nil error
	// must fail the build — a declared pipeline is never silently skipped
	// (constellation/doc/DOC-BUILD-PLAN.md Phase 3).
	Run(opts RunOptions) (string, error)
}

// RunOptions parameterize a Tailwind run.
type RunOptions struct {
	// AppRoot is the absolute app root (the directory holding app/).
	AppRoot string
	// Input is the absolute path to the input CSS entry, or "" to let Tailwind
	// use its default (which still emits the utility layers).
	Input string
	// Production adds --minify to the CLI invocation.
	Production bool
}

// Compose builds the final dist/styles.css contents: the Tailwind layer first,
// then the collected <style> blocks. Either part may be empty. A single
// trailing newline is guaranteed when there is any content.
func Compose(tailwindCSS, collected string) string {
	tw := strings.TrimRight(tailwindCSS, "\n")
	cs := strings.TrimRight(collected, "\n")

	var b strings.Builder
	if tw != "" {
		b.WriteString(tw)
	}
	if cs != "" {
		if b.Len() > 0 {
			b.WriteString("\n\n")
		}
		b.WriteString(cs)
	}
	if b.Len() > 0 {
		b.WriteString("\n")
	}
	return b.String()
}

// NpxRunner runs the Tailwind CLI once per build. It resolves the CLI directly
// from node_modules first (running `node <@tailwindcss/cli bin>` for v4 or the
// `.bin/tailwindcss` shim for v3, skipping npx's resolution + a Node cold start
// — D27), then falls back to `npx @tailwindcss/cli` (v4) and `npx tailwindcss`
// (v3). If none can run — no Node/npx, offline with nothing cached — Run returns
// a clear toolchain-missing error so the declared pipeline fails loudly rather
// than producing a silently empty stylesheet.
type NpxRunner struct{}

// Run implements Runner. It writes Tailwind's output to a temp file, reads it
// back, and returns it as a string (keeping the single-output-file contract in
// Compose's hands rather than letting the CLI own dist/styles.css directly).
func (NpxRunner) Run(opts RunOptions) (string, error) {
	tmp, err := os.CreateTemp("", "puzzle-tailwind-*.css")
	if err != nil {
		return "", fmt.Errorf("creating temp file for Tailwind output: %w", err)
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	var failures []string
	for _, c := range resolveCLIs(opts.AppRoot) {
		args := append([]string{}, c.Args...)
		if opts.Input != "" {
			args = append(args, "-i", opts.Input)
		}
		args = append(args, "-o", tmpPath)
		if opts.Production {
			args = append(args, "--minify")
		}

		cmd := exec.Command(c.Exec, args...)
		cmd.Dir = opts.AppRoot
		var stderr strings.Builder
		cmd.Stderr = &stderr

		if err := cmd.Run(); err != nil {
			failures = append(failures, fmt.Sprintf("  %s: %s", c.Name, firstLine(stderr.String(), err)))
			continue
		}

		out, readErr := os.ReadFile(tmpPath)
		if readErr != nil {
			return "", fmt.Errorf("reading Tailwind output: %w", readErr)
		}
		return string(out), nil
	}

	return "", fmt.Errorf(
		"Tailwind pipeline is declared in puzzle.config.js but the Tailwind CLI could not be run.\n"+
			"Install Tailwind (`npm install tailwindcss @tailwindcss/cli`) or remove the pipeline.\n"+
			"Attempts:\n%s",
		strings.Join(failures, "\n"),
	)
}

// firstLine returns the first non-empty line of a CLI's stderr, or the process
// error when stderr is empty (e.g. npx not found). It keeps toolchain-missing
// messages compact.
func firstLine(stderr string, runErr error) string {
	for _, line := range strings.Split(stderr, "\n") {
		if s := strings.TrimSpace(line); s != "" {
			return s
		}
	}
	return runErr.Error()
}

// DefaultInput returns the app's Tailwind input CSS path if the conventional
// app/styles/styles.css exists, else "" (Tailwind uses its default).
func DefaultInput(appRoot string) string {
	p := filepath.Join(appRoot, "app", "styles", "styles.css")
	if info, err := os.Stat(p); err == nil && !info.IsDir() {
		return p
	}
	return ""
}
