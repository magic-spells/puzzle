package styles

import (
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
	for _, want := range []string{"Tailwind pipeline is declared", "could not be run", "Attempts:"} {
		if !strings.Contains(msg, want) {
			t.Errorf("missing-toolchain error should contain %q, got:\n%s", want, msg)
		}
	}
}
