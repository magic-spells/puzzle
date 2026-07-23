package codegen

import (
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/parser"
)

// compileScoped splits + compiles src at the given mode and returns the JS.
func compileScoped(t *testing.T, src, filename string, mode EmissionMode) string {
	t.Helper()
	sec, err := parser.SplitSections(src, filename)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	res, err := Compile(sec, Options{Filename: filename, Mode: mode})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	return res.JS
}

// TestScopeIDStable pins the id derivation (v1.27, D59): `pzl-` + 8-hex FNV-1a-32
// of the forward-slash-normalized path, byte-stable and backslash-insensitive.
func TestScopeIDStable(t *testing.T) {
	if got := ScopeID("scoped_styles.pzl"); got != "pzl-97203688" {
		t.Fatalf("ScopeID(scoped_styles.pzl) = %q, want pzl-97203688", got)
	}
	// Backslashes normalize to forward slashes, so a Windows-shaped path yields
	// the same id as its POSIX form.
	if a, b := ScopeID("app/views/Home.pzl"), ScopeID("app\\views\\Home.pzl"); a != b {
		t.Fatalf("ScopeID not slash-normalized: %q vs %q", a, b)
	}
}

// TestScopedStampCoversSkeleton proves a scoped view stamps BOTH render() and
// renderSkeleton() with the same data-<scopeId> attribute — the view-mode
// skeleton reuses the stamped <puzzle-view> root attrs (D39), so declaring a
// skeleton needs no extra scoping work.
func TestScopedStampCoversSkeleton(t *testing.T) {
	src := `<puzzle-view class="post">
  <p>{ post.body }</p>
</puzzle-view>

<puzzle-skeleton>
  <div class="bg-skeleton"></div>
</puzzle-skeleton>

<style scoped>
.post { padding: 1rem; }
</style>
`
	got := compileScoped(t, src, "Post.pzl", ModeView)
	stamp := "'data-" + ScopeID("Post.pzl") + "': true"
	renderIdx := strings.Index(got, ".prototype.render = function")
	skelIdx := strings.Index(got, ".prototype.renderSkeleton = function")
	if renderIdx < 0 || skelIdx < 0 {
		t.Fatalf("expected both render and renderSkeleton tails\n%s", got)
	}
	if !strings.Contains(got[renderIdx:skelIdx], stamp) {
		t.Errorf("render() missing the scope stamp %q\n%s", stamp, got)
	}
	if !strings.Contains(got[skelIdx:], stamp) {
		t.Errorf("renderSkeleton() missing the scope stamp %q\n%s", stamp, got)
	}
}

// TestScopedStampComponentMode proves scoped stamps the inline single root
// element in component mode (the rendered root vnode, since <puzzle-view> is not
// emitted there).
func TestScopedStampComponentMode(t *testing.T) {
	src := `<puzzle-view>
  <div class="badge">{ label }</div>
</puzzle-view>

<style scoped>
.badge { color: teal; }
</style>
`
	got := compileScoped(t, src, "Badge.pzl", ModeComponent)
	stamp := "'data-" + ScopeID("Badge.pzl") + "': true"
	if !strings.Contains(got, stamp) {
		t.Errorf("component root missing the scope stamp %q\n%s", stamp, got)
	}
	// Root-only: the stamp appears exactly once (no per-node stamping).
	if n := strings.Count(got, stamp); n != 1 {
		t.Errorf("expected exactly one scope stamp, got %d\n%s", n, got)
	}
}

// TestUnscopedNoStamp guards byte-identity: a <style> block without `scoped`
// (and a file with no styles at all) emits no data-pzl attribute.
func TestUnscopedNoStamp(t *testing.T) {
	src := `<puzzle-view class="x"><p>{ y }</p></puzzle-view>
<style>.x{color:red}</style>
`
	got := compileScoped(t, src, "X.pzl", ModeView)
	if strings.Contains(got, "data-pzl-") {
		t.Errorf("unscoped <style> must not stamp a data-pzl attribute\n%s", got)
	}
}
