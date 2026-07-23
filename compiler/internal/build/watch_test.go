package build

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// repoRoot returns the module root (three levels up from compiler/internal/build),
// where client-runtime/ lives so the '@magic-spells/puzzle' alias resolves.
func repoRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Clean(filepath.Join(wd, "..", "..", ".."))
	if _, err := os.Stat(filepath.Join(root, "client-runtime", "index.js")); err != nil {
		t.Fatalf("client-runtime not found at %s: %v", root, err)
	}
	return root
}

// scratchApp creates a throwaway Puzzle app UNDER the repo root (so findRuntime
// walks up to client-runtime) and returns its root. Auto-removed on cleanup.
func scratchApp(t *testing.T) string {
	t.Helper()
	root, err := os.MkdirTemp(repoRoot(t), "puzzle-watchtest-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	for _, d := range []string{"app/views", "app/components", "app/public"} {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write(t, filepath.Join(root, "app", "public", "index.html"), "<html><body></body></html>")
	return root
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

const viewTmpl = `<puzzle-view>
  <h1>%MARKER%</h1>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>

<style>
.home { color: red; }
</style>
`

const extraPzl = `<puzzle-view>
  <span>extra</span>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Extra extends PuzzleView {}
</script>

<style>
.extra { color: blue; }
</style>
`

// TestWatchBuilderIncrementalRebuild proves the persistent esbuild context
// reflects source edits across successive Rebuild() calls.
func TestWatchBuilderIncrementalRebuild(t *testing.T) {
	root := scratchApp(t)
	home := filepath.Join(root, "app", "views", "Home.pzl")
	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "MARKER_ONE"))
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	b, err := NewWatchBuilder(root)
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if err := b.Rebuild(); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	bundle := readDistBundle(t, root)
	if !strings.Contains(bundle, "MARKER_ONE") {
		t.Fatalf("first bundle missing MARKER_ONE:\n%s", bundle)
	}

	// Edit the view and rebuild — the incremental context must pick it up.
	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "MARKER_TWO"))
	if err := b.Rebuild(); err != nil {
		t.Fatalf("second Rebuild: %v", err)
	}
	bundle = readDistBundle(t, root)
	if !strings.Contains(bundle, "MARKER_TWO") {
		t.Errorf("second bundle missing MARKER_TWO (incremental rebuild did not re-read the edit):\n%s", bundle)
	}
	if strings.Contains(bundle, "MARKER_ONE") {
		t.Errorf("second bundle still contains the stale MARKER_ONE")
	}
}

// TestWatchBuilderCSSResetOnDelete proves the shared <style> collector drops a
// deleted .pzl's CSS between rebuilds (no lingering stale styles).
func TestWatchBuilderCSSResetOnDelete(t *testing.T) {
	root := scratchApp(t)
	write(t, filepath.Join(root, "app", "views", "Home.pzl"),
		strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	extra := filepath.Join(root, "app", "components", "Extra.pzl")
	write(t, extra, extraPzl)
	appJS := filepath.Join(root, "app", "app.js")
	write(t, appJS,
		"import Home from './views/Home.pzl';\nimport Extra from './components/Extra.pzl';\nconsole.log(Home, Extra);\n")

	b, err := NewWatchBuilder(root)
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if err := b.Rebuild(); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	css := b.CSS()
	if !strings.Contains(css, ".home") || !strings.Contains(css, ".extra") {
		t.Fatalf("first CSS should contain both blocks, got:\n%s", css)
	}

	// Remove the component from the graph and delete its file.
	write(t, appJS, "import Home from './views/Home.pzl';\nconsole.log(Home);\n")
	if err := os.Remove(extra); err != nil {
		t.Fatal(err)
	}
	if err := b.Rebuild(); err != nil {
		t.Fatalf("second Rebuild: %v", err)
	}
	css = b.CSS()
	if strings.Contains(css, ".extra") {
		t.Errorf("deleted component's styles linger in CSS after rebuild:\n%s", css)
	}
	if !strings.Contains(css, ".home") {
		t.Errorf("surviving view's styles were lost:\n%s", css)
	}
}

// TestWatchBuilderCSSResetOnStyleRemoval proves editing a file to REMOVE its
// <style> drops the stale block (the collector's set-or-delete path).
func TestWatchBuilderCSSResetOnStyleRemoval(t *testing.T) {
	root := scratchApp(t)
	home := filepath.Join(root, "app", "views", "Home.pzl")
	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	b, err := NewWatchBuilder(root)
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if err := b.Rebuild(); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	if !strings.Contains(b.CSS(), ".home") {
		t.Fatalf("first CSS should contain .home, got:\n%s", b.CSS())
	}

	// Rewrite the view without a <style> block.
	noStyles := `<puzzle-view>
  <h1>HOME</h1>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	write(t, home, noStyles)
	if err := b.Rebuild(); err != nil {
		t.Fatalf("second Rebuild: %v", err)
	}
	if strings.Contains(b.CSS(), ".home") {
		t.Errorf("removed <style> block lingers after rebuild:\n%s", b.CSS())
	}
}

// TestMetafileInputs proves the metafile normalization keeps only .pzl inputs,
// resolves cwd-relative keys to absolute paths (matching the plugin's args.Path
// css keys), and skips non-.pzl inputs (JS, the namespaced virtual manifest).
func TestMetafileInputs(t *testing.T) {
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	absPzl := filepath.Join(wd, "app", "components", "Card.pzl")
	metafile := `{
	  "inputs": {
	    "app/views/Home.pzl": {"bytes": 10},
	    "` + filepath.ToSlash(absPzl) + `": {"bytes": 20},
	    "app/app.js": {"bytes": 5},
	    "node_modules/@magic-spells/puzzle/client-runtime/index.js": {"bytes": 7},
	    "puzzle-formatters-manifest:@magic-spells/puzzle/formatters/manifest": {"bytes": 3}
	  },
	  "outputs": {}
	}`

	got, err := metafileInputs(metafile)
	if err != nil {
		t.Fatalf("metafileInputs: %v", err)
	}

	wantRel := filepath.Join(wd, "app", "views", "Home.pzl")
	if !got[wantRel] {
		t.Errorf("relative .pzl key not resolved to absolute %q; got %#v", wantRel, got)
	}
	if !got[absPzl] {
		t.Errorf("absolute .pzl key missing %q; got %#v", absPzl, got)
	}
	for bad := range got {
		if !strings.HasSuffix(bad, ".pzl") {
			t.Errorf("non-.pzl input leaked into keep set: %q", bad)
		}
	}
	if len(got) != 2 {
		t.Errorf("expected exactly 2 .pzl inputs, got %d: %#v", len(got), got)
	}
}

// TestWatchBuilderCSSPrunesUnimported is the core Fix 2 case the os.Stat prune
// cannot catch: a component dropped from the import graph but STILL ON DISK. Its
// onLoad never re-runs, so only the metafile-driven prune removes the stale CSS.
// Re-adding the import restores it.
func TestWatchBuilderCSSPrunesUnimported(t *testing.T) {
	root := scratchApp(t)
	write(t, filepath.Join(root, "app", "views", "Home.pzl"),
		strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	extra := filepath.Join(root, "app", "components", "Extra.pzl")
	write(t, extra, extraPzl)
	appJS := filepath.Join(root, "app", "app.js")
	withExtra := "import Home from './views/Home.pzl';\nimport Extra from './components/Extra.pzl';\nconsole.log(Home, Extra);\n"
	withoutExtra := "import Home from './views/Home.pzl';\nconsole.log(Home);\n"
	write(t, appJS, withExtra)

	b, err := NewWatchBuilder(root)
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if err := b.Rebuild(); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	if css := b.CSS(); !strings.Contains(css, ".home") || !strings.Contains(css, ".extra") {
		t.Fatalf("first CSS should contain both blocks, got:\n%s", css)
	}

	// Drop the import but LEAVE Extra.pzl on disk. os.Stat still finds it, so only
	// the module-graph prune can remove its CSS.
	write(t, appJS, withoutExtra)
	if err := b.Rebuild(); err != nil {
		t.Fatalf("second Rebuild: %v", err)
	}
	if css := b.CSS(); strings.Contains(css, ".extra") {
		t.Errorf("un-imported (but on-disk) component's styles linger after rebuild:\n%s", css)
	} else if !strings.Contains(css, ".home") {
		t.Errorf("surviving view's styles were lost:\n%s", css)
	}

	// Re-add the import — onLoad re-runs and the CSS returns.
	write(t, appJS, withExtra)
	if err := b.Rebuild(); err != nil {
		t.Fatalf("third Rebuild: %v", err)
	}
	if css := b.CSS(); !strings.Contains(css, ".extra") {
		t.Errorf("re-imported component's styles did not return:\n%s", css)
	}
}

// TestWatchBuilderFailedRebuildKeepsCSS proves a failed rebuild leaves the css
// map untouched (last-good styles keep being served) — no prune on failure.
func TestWatchBuilderFailedRebuildKeepsCSS(t *testing.T) {
	root := scratchApp(t)
	home := filepath.Join(root, "app", "views", "Home.pzl")
	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	appJS := filepath.Join(root, "app", "app.js")
	write(t, appJS, "import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	b, err := NewWatchBuilder(root)
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if err := b.Rebuild(); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	if !strings.Contains(b.CSS(), ".home") {
		t.Fatalf("first CSS should contain .home, got:\n%s", b.CSS())
	}

	// Introduce a compile error (unclosed {#if}) — the rebuild must fail and the
	// last-good .home CSS must survive.
	write(t, home, `<puzzle-view>{#if open}<h1>HOME</h1></puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
<style>
.home { color: red; }
</style>
`)
	if err := b.Rebuild(); err == nil {
		t.Fatal("expected the rebuild to fail on the unclosed {#if}")
	}
	if !strings.Contains(b.CSS(), ".home") {
		t.Errorf("failed rebuild dropped the last-good CSS:\n%s", b.CSS())
	}
}

// svgHomeTmpl is a view that inlines app/assets/icons/heart.svg via {#svg}.
const svgHomeTmpl = `<puzzle-view>
  <span class="inline-block size-5">{#svg 'icons/heart.svg'}</span>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`

// TestWatchBuilderInlineSVGRebuild is the WatchFiles regression (v1.14, D46):
// editing ONLY the inlined .svg (not the .pzl) must invalidate the cached OnLoad
// result and re-inline the new markup on the next Rebuild.
func TestWatchBuilderInlineSVGRebuild(t *testing.T) {
	root := scratchApp(t)
	icon := filepath.Join(root, "app", "assets", "icons", "heart.svg")
	if err := os.MkdirAll(filepath.Dir(icon), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, icon, `<svg viewBox="0 0 1 1"><path d="MARKER_ONE"/></svg>`)
	write(t, filepath.Join(root, "app", "views", "Home.pzl"), svgHomeTmpl)
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	b, err := NewWatchBuilder(root)
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if err := b.Rebuild(); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	if bundle := readDistBundle(t, root); !strings.Contains(bundle, "MARKER_ONE") {
		t.Fatalf("first bundle missing inlined MARKER_ONE:\n%s", bundle)
	}

	// Edit ONLY the svg file — the .pzl is untouched.
	write(t, icon, `<svg viewBox="0 0 1 1"><path d="MARKER_TWO"/></svg>`)
	if err := b.Rebuild(); err != nil {
		t.Fatalf("second Rebuild: %v", err)
	}
	bundle := readDistBundle(t, root)
	if !strings.Contains(bundle, "MARKER_TWO") {
		t.Errorf("second bundle missing MARKER_TWO — WatchFiles did not invalidate the cached inline:\n%s", bundle)
	}
	if strings.Contains(bundle, "MARKER_ONE") {
		t.Errorf("second bundle still contains the stale MARKER_ONE")
	}
}

// TestWatchBuilderInlineSVGRecovery proves WatchFiles is set even on a FAILED
// build (missing svg): once the file is created, the next Rebuild picks it up
// instead of serving the cached failure.
func TestWatchBuilderInlineSVGRecovery(t *testing.T) {
	root := scratchApp(t)
	icon := filepath.Join(root, "app", "assets", "icons", "heart.svg")
	if err := os.MkdirAll(filepath.Dir(icon), 0o755); err != nil {
		t.Fatal(err)
	}
	// The .pzl references the icon, but the file does not exist yet.
	write(t, filepath.Join(root, "app", "views", "Home.pzl"), svgHomeTmpl)
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	b, err := NewWatchBuilder(root)
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if err := b.Rebuild(); err == nil {
		t.Fatal("expected the first Rebuild to fail on the missing svg")
	}

	// Create the previously-missing svg; WatchFiles recorded its path on the error
	// result, so the cached failure is invalidated.
	write(t, icon, `<svg viewBox="0 0 1 1"><path d="RECOVERED"/></svg>`)
	if err := b.Rebuild(); err != nil {
		t.Fatalf("Rebuild after creating the svg should succeed: %v", err)
	}
	if bundle := readDistBundle(t, root); !strings.Contains(bundle, "RECOVERED") {
		t.Errorf("bundle missing RECOVERED after the svg appeared:\n%s", bundle)
	}
}

// TestWatchBuilderMirrorsPublicDeletions proves the incremental dev path mirrors
// public deletions into dist: a copied asset appears after the first rebuild and
// is REMOVED after the next rebuild once its source is deleted, while build
// outputs (app.js) and still-present public files (index.html) survive.
func TestWatchBuilderMirrorsPublicDeletions(t *testing.T) {
	root := scratchApp(t)
	write(t, filepath.Join(root, "app", "views", "Home.pzl"),
		strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	// scratchApp already seeds app/public/index.html; add a second asset we will
	// delete mid-session.
	asset := filepath.Join(root, "app", "public", "logo.txt")
	write(t, asset, "LOGO")

	b, err := NewWatchBuilder(root)
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if err := b.Rebuild(); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	dist := filepath.Join(root, "dist")
	distAsset := filepath.Join(dist, "logo.txt")
	if _, err := os.Stat(distAsset); err != nil {
		t.Fatalf("public asset not copied to dist on first rebuild: %v", err)
	}

	// Delete the source asset and rebuild — the incremental path must mirror the
	// deletion (the one-shot build prunes via a full wipe; dev keeps dist warm).
	if err := os.Remove(asset); err != nil {
		t.Fatal(err)
	}
	if err := b.Rebuild(); err != nil {
		t.Fatalf("second Rebuild: %v", err)
	}
	if _, err := os.Stat(distAsset); !os.IsNotExist(err) {
		t.Errorf("deleted public asset lingered in dist after rebuild (err=%v)", err)
	}

	// Build outputs and still-present public files must NOT be touched by the mirror.
	if _, err := os.Stat(filepath.Join(dist, "app.js")); err != nil {
		t.Errorf("mirror removed the build output dist/app.js: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Errorf("mirror removed a still-present public file dist/index.html: %v", err)
	}

	// Re-adding the asset restores it (prevPublic tracking stays consistent).
	write(t, asset, "LOGO2")
	if err := b.Rebuild(); err != nil {
		t.Fatalf("third Rebuild: %v", err)
	}
	if got, err := os.ReadFile(distAsset); err != nil || string(got) != "LOGO2" {
		t.Errorf("re-added public asset not restored: got=%q err=%v", got, err)
	}
}

func readDistBundle(t *testing.T, root string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
