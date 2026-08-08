package build

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

// A static build runs three esbuild passes, and each of them used to redo the
// project-wide usage walk over identical bytes. The profiler's phase table is
// the observable proof that it now happens exactly once: "usage scan" is
// recorded by Build alone, so a second scan reintroduced anywhere in the
// prerender or per-page pass would have to add a row (or silently cost time
// under no row at all — which the reviewer of a diff would still see, but this
// test pins the cheap half).
func TestStaticBuildScansUsageOnce(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, baseSSGFixture())

	var buildErr error
	out := captureStderr(t, func() {
		buildErr = Build(root, Options{Development: true, Output: "static", Profile: true})
	})
	if buildErr != nil {
		t.Fatalf("static Build failed: %v\n%s", buildErr, out)
	}

	if n := strings.Count(out, "usage scan"); n != 1 {
		t.Errorf("profile reported %d 'usage scan' phases, want exactly 1:\n%s", n, out)
	}
}

// Every pass's plugin must start from the SAME scan result. passContext is the
// only constructor build code may use for that reason, so a plugin it hands out
// carries the scanned feature bits rather than a zero Usage.
func TestPassContextPluginsShareUsage(t *testing.T) {
	root := writeSSGFixture(t, baseSSGFixture())

	pc, err := newPassContext(root)
	if err != nil {
		t.Fatalf("newPassContext: %v", err)
	}
	first := pc.plugin(root).Features()
	second := pc.plugin(root).Features()
	if first != second {
		t.Errorf("two passes disagree on the feature defines: %+v vs %+v", first, second)
	}
	// …and it matches what an independent scan of the same tree would produce,
	// so sharing the result never changes the defines a pass would have chosen.
	fresh := plugin.New(root)
	if err := scanUsage(root, fresh); err != nil {
		t.Fatalf("scanUsage: %v", err)
	}
	if first != fresh.Features() {
		t.Errorf("shared features %+v differ from a fresh scan's %+v", first, fresh.Features())
	}
}
