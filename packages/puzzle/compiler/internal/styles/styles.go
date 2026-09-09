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
//
// # What Tailwind v4 scans, and how the compiler stays out of its way
//
// Verified against @tailwindcss/cli 4.3.3. When the input CSS does not pin its
// own sources — no `@import "tailwindcss" source(…)`, no `@source` directives —
// the CLI registers ONE source root of `**/*` based at `--cwd`, which defaults
// to process.cwd(). Both runners set the child's working directory to the app
// root, so Tailwind walks the whole app root. The walk honors .gitignore, and
// there is no CLI flag for excluding a path: negative sources exist only as
// `@source not "…"` INSIDE the CSS, which is the user's file.
//
// So the only lever the compiler has over that scan is what is gitignored, and
// the only tree it may take is its own. That is why every transient build
// directory now lives under a self-ignoring `<root>/.puzzle/` (internal/build/
// workdir.go): measured on 4.3.3, a `.dist-staging-*` or `dist.old-*` leftover
// beside dist/ IS scanned even in a project whose .gitignore says `dist`, since
// neither name matches that rule — ten of them took the reference site's source
// scan from 112ms to 14s.
//
// dist/ ITSELF is deliberately left alone. In a project that gitignores dist
// (the overwhelming default, and what every Puzzle template ships) it is
// already excluded. In a project that does not, excluding it from Go would
// change which sources Tailwind scans without the user asking — exactly the
// user-visible behavior change this must not make — and the compiler cannot do
// it without either rewriting the user's .gitignore, writing a .gitignore into
// its own shipped output, or injecting `@source not` into the user's CSS. None
// of those is worth it once the unignorable leftovers are gone.
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
	// CLIs overrides the resolved Tailwind CLI candidates. Tests inject fakes
	// here so the failure diagnostics can be exercised without a real Tailwind
	// (and without falling through to npx). Empty means "resolve normally".
	CLIs []ResolvedCLI
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

	clis := opts.CLIs
	if len(clis) == 0 {
		clis = resolveCLIs(opts.AppRoot)
	}

	var failures []string
	for _, c := range clis {
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
			failures = append(failures, describeFailure(c.Name, stderr.String(), err))
			continue
		}

		out, readErr := os.ReadFile(tmpPath)
		if readErr != nil {
			return "", fmt.Errorf("reading Tailwind output: %w", readErr)
		}
		return string(out), nil
	}

	return "", fmt.Errorf(
		"Tailwind pipeline is declared in puzzle.config.js but no Tailwind CLI run succeeded.\n"+
			"Fix the errors below, install Tailwind (`npm install tailwindcss @tailwindcss/cli`),\n"+
			"or remove the pipeline from puzzle.config.js.\n"+
			"Attempts:\n%s",
		strings.Join(failures, "\n"),
	)
}

// stderrTailLines caps how much of a failing CLI's stderr is echoed into the
// build error: enough for Tailwind's multi-line resolver/parse diagnostics,
// short enough that four failed attempts stay readable.
const stderrTailLines = 20

// describeFailure renders one failed CLI attempt. When the process ran and
// exited non-zero its stderr is the actual diagnosis (an unresolvable @import,
// a CSS parse error), so the tail of it is echoed verbatim under the attempt
// line — reporting only "could not be run" there hides the real cause behind a
// version banner. When the process never started, or wrote nothing, the exec
// error is all there is to report.
func describeFailure(name, stderr string, runErr error) string {
	head := fmt.Sprintf("  %s: %s", name, runErr)
	tail := tailLines(stderr, stderrTailLines)
	if tail == "" {
		return head
	}
	return head + "\n" + indentLines(tail, "    ")
}

// tailLines returns at most the last n non-blank-trimmed lines of s, with
// surrounding blank lines dropped and a marker when earlier lines were cut.
func tailLines(s string, n int) string {
	var lines []string
	for _, line := range strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n") {
		if strings.TrimSpace(line) != "" {
			lines = append(lines, strings.TrimRight(line, " \t\r"))
		}
	}
	if len(lines) == 0 {
		return ""
	}
	if len(lines) > n {
		cut := len(lines) - n
		lines = append([]string{fmt.Sprintf("… %d earlier stderr line(s) omitted", cut)}, lines[cut:]...)
	}
	return strings.Join(lines, "\n")
}

// indentLines prefixes every line of s with prefix.
func indentLines(s, prefix string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = prefix + line
	}
	return strings.Join(lines, "\n")
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
