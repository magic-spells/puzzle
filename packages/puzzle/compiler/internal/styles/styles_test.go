package styles

import (
	"runtime"
	"strings"
	"testing"
)

func TestComposeTailwindThenCollected(t *testing.T) {
	// Tailwind output comes first; the collected <style> blocks are appended.
	tailwind := ".btn{color:blue}"
	// The collector already sorts blocks by source path; Compose preserves that
	// order verbatim (here two blocks, A before B).
	collected := ".card-a{padding:1rem}\n\n.card-b{margin:0}"
	got := Compose(tailwind, collected)

	iTw := strings.Index(got, ".btn")
	iA := strings.Index(got, ".card-a")
	iB := strings.Index(got, ".card-b")
	if iTw < 0 || iA < 0 || iB < 0 {
		t.Fatalf("missing content in composed CSS:\n%s", got)
	}
	if !(iTw < iA && iA < iB) {
		t.Errorf("expected order tailwind < card-a < card-b, got positions %d,%d,%d:\n%s", iTw, iA, iB, got)
	}
	if !strings.HasSuffix(got, "\n") {
		t.Error("composed CSS should end with a single newline")
	}
}

func TestComposeOnlyCollected(t *testing.T) {
	// No Tailwind layer (pipeline disabled): output is just the collected CSS.
	got := Compose("", ".x{color:green}")
	if strings.Contains(got, "{color:green}") == false {
		t.Errorf("expected collected CSS, got: %q", got)
	}
	if strings.TrimSpace(got) != ".x{color:green}" {
		t.Errorf("unexpected content with no tailwind: %q", got)
	}
}

func TestComposeOnlyTailwind(t *testing.T) {
	got := Compose(".u{display:flex}", "")
	if strings.TrimSpace(got) != ".u{display:flex}" {
		t.Errorf("unexpected content with no collected blocks: %q", got)
	}
}

func TestComposeEmpty(t *testing.T) {
	if got := Compose("", ""); got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

// TestNpxRunnerMissingToolchain documents and pins the real-exec failure mode:
// when neither Tailwind CLI can run (offline with nothing installed, or npx
// absent), Run returns a clear, actionable error rather than empty CSS. If the
// toolchain IS available in this environment, the run succeeds and there is
// nothing to assert about the error path, so we skip.
func TestNpxRunnerMissingToolchain(t *testing.T) {
	_, err := NpxRunner{}.Run(RunOptions{AppRoot: t.TempDir()})
	if err == nil {
		t.Skip("Tailwind CLI is runnable in this environment; missing-toolchain path not exercised")
	}
	msg := err.Error()
	for _, want := range []string{"Tailwind pipeline is declared", "no Tailwind CLI run succeeded", "Attempts:"} {
		if !strings.Contains(msg, want) {
			t.Errorf("missing-toolchain error should contain %q, got:\n%s", want, msg)
		}
	}
}

// failingCLI returns a fake ResolvedCLI standing in for a Tailwind CLI that
// STARTS, prints a real diagnosis to stderr, and exits 1 — the shape of an
// unresolvable `@import "@magic-spells/…/css"` (a dangling file: dependency in
// CI). Run appends -i/-o/--minify after Args; with `sh -c <script> <arg0> ...`
// those land as ignored positional params.
func failingCLI(script string) ResolvedCLI {
	return ResolvedCLI{
		Name: "fake-tailwind",
		Exec: "sh",
		Args: []string{"-c", script, "fake-tailwind"},
	}
}

// TestRunEchoesStderrOfFailedCLI pins the regression this package shipped: the
// old diagnostic reported only the FIRST non-empty stderr line, which for
// Tailwind v4 is its "≈ tailwindcss v4.3.3" banner — so a build that failed on
// an unresolvable @import reported four identical version strings and claimed
// the CLI "could not be run". The real error must survive into the message.
func TestRunEchoesStderrOfFailedCLI(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake shell CLI is unix-only")
	}
	script := `echo "~ tailwindcss v4.3.3" >&2; echo "Error:" >&2; echo "| Error: Can't resolve '@magic-spells/dropdown-panel/css'" >&2; exit 1`
	_, err := NpxRunner{}.Run(RunOptions{
		AppRoot: t.TempDir(),
		CLIs:    []ResolvedCLI{failingCLI(script)},
	})
	if err == nil {
		t.Fatal("expected Run to fail when the only CLI exits non-zero")
	}
	msg := err.Error()
	for _, want := range []string{
		"fake-tailwind: exit status 1",
		"Can't resolve '@magic-spells/dropdown-panel/css'",
		"~ tailwindcss v4.3.3",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("failed-CLI error should contain %q, got:\n%s", want, msg)
		}
	}
	// The banner must not be the ONLY thing reported (the old behavior).
	if strings.Contains(msg, "could not be run") {
		t.Errorf("a CLI that ran and exited non-zero must not be reported as unrunnable:\n%s", msg)
	}
}

// TestRunStderrTailIsCapped keeps a runaway CLI from burying the build output:
// only the last stderrTailLines lines survive, with a marker for the rest.
func TestRunStderrTailIsCapped(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake shell CLI is unix-only")
	}
	_, err := NpxRunner{}.Run(RunOptions{
		AppRoot: t.TempDir(),
		CLIs:    []ResolvedCLI{failingCLI(`for i in $(seq 1 60); do echo "line $i" >&2; done; exit 1`)},
	})
	if err == nil {
		t.Fatal("expected Run to fail")
	}
	msg := err.Error()
	if !strings.Contains(msg, "line 60") {
		t.Errorf("the tail of stderr must survive, got:\n%s", msg)
	}
	if strings.Contains(msg, "line 1\n") {
		t.Errorf("the head of a long stderr should be trimmed, got:\n%s", msg)
	}
	if !strings.Contains(msg, "earlier stderr line(s) omitted") {
		t.Errorf("truncation should be marked, got:\n%s", msg)
	}
}

// TestRunReportsExecErrorWhenNothingRan keeps the toolchain-missing path
// intact: a CLI that never starts has no stderr, so the exec error is reported.
func TestRunReportsExecErrorWhenNothingRan(t *testing.T) {
	_, err := NpxRunner{}.Run(RunOptions{
		AppRoot: t.TempDir(),
		CLIs:    []ResolvedCLI{{Name: "bogus", Exec: "puzzle-nonexistent-binary-xyz"}},
	})
	if err == nil {
		t.Fatal("expected Run to fail when the CLI cannot be started")
	}
	if !strings.Contains(err.Error(), "bogus: ") {
		t.Errorf("expected the exec error under the attempt name, got:\n%s", err)
	}
}
