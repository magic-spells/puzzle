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

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	bundle := readDistBundle(t, root)
	if !strings.Contains(bundle, "MARKER_ONE") {
		t.Fatalf("first bundle missing MARKER_ONE:\n%s", bundle)
	}

	// Edit the view and rebuild — the incremental context must pick it up.
	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "MARKER_TWO"))
	if _, err := b.Rebuild([]string{home}); err != nil {
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

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if _, err := b.Rebuild(nil); err != nil {
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
	if _, err := b.Rebuild([]string{appJS, extra}); err != nil {
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

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if _, err := b.Rebuild(nil); err != nil {
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
	if _, err := b.Rebuild([]string{home}); err != nil {
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

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	if css := b.CSS(); !strings.Contains(css, ".home") || !strings.Contains(css, ".extra") {
		t.Fatalf("first CSS should contain both blocks, got:\n%s", css)
	}

	// Drop the import but LEAVE Extra.pzl on disk. os.Stat still finds it, so only
	// the module-graph prune can remove its CSS.
	write(t, appJS, withoutExtra)
	if _, err := b.Rebuild([]string{appJS}); err != nil {
		t.Fatalf("second Rebuild: %v", err)
	}
	if css := b.CSS(); strings.Contains(css, ".extra") {
		t.Errorf("un-imported (but on-disk) component's styles linger after rebuild:\n%s", css)
	} else if !strings.Contains(css, ".home") {
		t.Errorf("surviving view's styles were lost:\n%s", css)
	}

	// Re-add the import — onLoad re-runs and the CSS returns.
	write(t, appJS, withExtra)
	if _, err := b.Rebuild([]string{appJS}); err != nil {
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

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if _, err := b.Rebuild(nil); err != nil {
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
	if _, err := b.Rebuild([]string{home}); err == nil {
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

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("first Rebuild: %v", err)
	}
	if bundle := readDistBundle(t, root); !strings.Contains(bundle, "MARKER_ONE") {
		t.Fatalf("first bundle missing inlined MARKER_ONE:\n%s", bundle)
	}

	// Edit ONLY the svg file — the .pzl is untouched.
	write(t, icon, `<svg viewBox="0 0 1 1"><path d="MARKER_TWO"/></svg>`)
	if _, err := b.Rebuild([]string{icon}); err != nil {
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

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if _, err := b.Rebuild(nil); err == nil {
		t.Fatal("expected the first Rebuild to fail on the missing svg")
	}

	// Create the previously-missing svg; WatchFiles recorded its path on the error
	// result, so the cached failure is invalidated.
	write(t, icon, `<svg viewBox="0 0 1 1"><path d="RECOVERED"/></svg>`)
	recovered, err := b.Rebuild([]string{icon})
	if err != nil {
		t.Fatalf("Rebuild after creating the svg should succeed: %v", err)
	}
	if !recovered.PublicSynced || !recovered.CSSChanged {
		t.Errorf("first successful rebuild metadata = %+v, want initial public/CSS work retained after failure", recovered)
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

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	if _, err := b.Rebuild(nil); err != nil {
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
	if _, err := b.Rebuild([]string{asset}); err != nil {
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
	if _, err := b.Rebuild([]string{asset}); err != nil {
		t.Fatalf("third Rebuild: %v", err)
	}
	if got, err := os.ReadFile(distAsset); err != nil || string(got) != "LOGO2" {
		t.Errorf("re-added public asset not restored: got=%q err=%v", got, err)
	}
}

func TestWatchBuilderClassifiesIncrementalWorkFromChangedPaths(t *testing.T) {
	root := scratchApp(t)
	home := filepath.Join(root, "app", "views", "Home.pzl")
	appJS := filepath.Join(root, "app", "app.js")
	asset := filepath.Join(root, "app", "public", "logo.txt")
	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	write(t, appJS, "import Home from './views/Home.pzl';\nconsole.log(Home);\n")
	write(t, asset, "LOGO-ONE")

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()

	initial, err := b.Rebuild(nil)
	if err != nil {
		t.Fatalf("initial Rebuild: %v", err)
	}
	if initial.UsageScanned {
		t.Error("initial rebuild repeated the usage scan already performed by the constructor")
	}
	if !initial.PublicSynced || !initial.CSSChanged || !initial.BundleBuilt {
		t.Fatalf("initial metadata = %+v, want public sync and initial CSS commit", initial)
	}

	write(t, appJS, "import Home from './views/Home.pzl';\nconsole.log(Home); // js-only\n")
	jsOnly, err := b.Rebuild([]string{appJS})
	if err != nil {
		t.Fatalf("JS-only Rebuild: %v", err)
	}
	if jsOnly.UsageScanned || jsOnly.PublicSynced || jsOnly.CSSChanged || !jsOnly.BundleBuilt {
		t.Errorf("JS-only metadata = %+v, want every unrelated phase skipped", jsOnly)
	}

	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME-TEMPLATE-ONLY"))
	templateOnly, err := b.Rebuild([]string{home})
	if err != nil {
		t.Fatalf("template-only Rebuild: %v", err)
	}
	if !templateOnly.UsageScanned || templateOnly.PublicSynced || templateOnly.CSSChanged || !templateOnly.BundleBuilt {
		t.Errorf("template-only metadata = %+v, want usage only", templateOnly)
	}

	write(t, asset, "LOGO-TWO")
	publicOnly, err := b.Rebuild([]string{asset})
	if err != nil {
		t.Fatalf("public-only Rebuild: %v", err)
	}
	if publicOnly.UsageScanned || !publicOnly.PublicSynced || publicOnly.CSSChanged || publicOnly.BundleBuilt {
		t.Errorf("public-only metadata = %+v, want public sync only", publicOnly)
	}
	if got, err := os.ReadFile(filepath.Join(root, "dist", "logo.txt")); err != nil || string(got) != "LOGO-TWO" {
		t.Errorf("public edit not mirrored: got=%q err=%v", got, err)
	}
}

func TestWatchBuilderFailedOnLoadKeepsCommittedCSS(t *testing.T) {
	root := scratchApp(t)
	home := filepath.Join(root, "app", "views", "Home.pzl")
	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial Rebuild: %v", err)
	}
	if css := b.CSS(); !strings.Contains(css, ".home { color: red; }") {
		t.Fatalf("initial committed CSS missing red block:\n%s", css)
	}

	// Puzzle successfully transforms this file and updates the plugin collector,
	// then esbuild rejects the preserved script syntax. This is the failure shape
	// that can otherwise leak candidate CSS through the Tailwind output poll.
	broken := strings.ReplaceAll(viewTmpl, ".home { color: red; }", ".home { color: blue; }")
	broken = strings.Replace(broken,
		"export default class Home extends PuzzleView {}",
		"export default class Home extends PuzzleView { broken = ; }", 1)
	write(t, home, strings.ReplaceAll(broken, "%MARKER%", "BROKEN"))
	if _, err := b.Rebuild([]string{home}); err == nil {
		t.Fatal("expected esbuild to reject the invalid preserved script")
	}
	if candidate := b.pl.CSS(); !strings.Contains(candidate, "color: blue") {
		t.Fatalf("test did not reach the candidate-CSS mutation path:\n%s", candidate)
	}
	if committed := b.CSS(); !strings.Contains(committed, "color: red") || strings.Contains(committed, "color: blue") {
		t.Errorf("failed rebuild leaked candidate CSS into the committed snapshot:\n%s", committed)
	}

	fixed := strings.Replace(broken,
		"export default class Home extends PuzzleView { broken = ; }",
		"export default class Home extends PuzzleView {}", 1)
	write(t, home, strings.ReplaceAll(fixed, "%MARKER%", "FIXED"))
	result, err := b.Rebuild([]string{home})
	if err != nil {
		t.Fatalf("recovery Rebuild: %v", err)
	}
	if !result.CSSChanged {
		t.Fatal("successful recovery did not report the candidate CSS becoming committed")
	}
	if committed := b.CSS(); !strings.Contains(committed, "color: blue") || strings.Contains(committed, "color: red") {
		t.Errorf("successful recovery did not promote blue CSS:\n%s", committed)
	}
}

func TestWatchBuilderPublicSourceFallbackAfterDelete(t *testing.T) {
	root := scratchApp(t)
	write(t, filepath.Join(root, "app", "views", "Home.pzl"),
		strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")
	appPublic := filepath.Join(root, "app", "public")
	write(t, filepath.Join(appPublic, "app-only.txt"), "APP")
	rootPublic := filepath.Join(root, "public")
	if err := os.MkdirAll(rootPublic, 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(rootPublic, "index.html"), "ROOT-INDEX")
	write(t, filepath.Join(rootPublic, "root-only.txt"), "ROOT")

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial Rebuild: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "dist", "app-only.txt")); err != nil {
		t.Fatalf("initial app/public asset missing: %v", err)
	}

	if err := os.RemoveAll(appPublic); err != nil {
		t.Fatal(err)
	}
	result, err := b.Rebuild([]string{appPublic})
	if err != nil {
		t.Fatalf("fallback Rebuild: %v", err)
	}
	if !result.PublicSynced {
		t.Fatal("deleting the previous public source did not schedule a full public sync")
	}
	if _, err := os.Stat(filepath.Join(root, "dist", "app-only.txt")); !os.IsNotExist(err) {
		t.Errorf("asset owned by deleted app/public source lingered (err=%v)", err)
	}
	if got, err := os.ReadFile(filepath.Join(root, "dist", "root-only.txt")); err != nil || string(got) != "ROOT" {
		t.Errorf("root public fallback not installed: got=%q err=%v", got, err)
	}
	if got, err := os.ReadFile(filepath.Join(root, "dist", "index.html")); err != nil || string(got) != "ROOT-INDEX" {
		t.Errorf("root public shell not installed: got=%q err=%v", got, err)
	}
}

func TestWatchBuilderRebuildsImportedPublicAsset(t *testing.T) {
	root := scratchApp(t)
	publicModule := filepath.Join(root, "app", "public", "message.js")
	write(t, publicModule, `export default "PUBLIC_IMPORT_ONE";`)
	write(t, filepath.Join(root, "app", "app.js"),
		"import message from './public/message.js';\nconsole.log(message);\n")

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Dispose()
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial Rebuild: %v", err)
	}

	write(t, publicModule, `export default "PUBLIC_IMPORT_TWO";`)
	result, err := b.Rebuild([]string{publicModule})
	if err != nil {
		t.Fatalf("public-module Rebuild: %v", err)
	}
	if !result.BundleBuilt || !result.PublicSynced {
		t.Fatalf("public-module metadata = %+v, want bundle and mirror", result)
	}
	if bundle := readDistBundle(t, root); !strings.Contains(bundle, "PUBLIC_IMPORT_TWO") {
		t.Fatalf("bundle did not rebuild imported public module:\n%s", bundle)
	}
}

func TestWatchBuilderPostBundlePublicFailureForcesCompleteRetry(t *testing.T) {
	root := scratchApp(t)
	home := filepath.Join(root, "app", "views", "Home.pzl")
	write(t, home, strings.ReplaceAll(viewTmpl, "%MARKER%", "HOME"))
	write(t, filepath.Join(root, "app", "app.js"),
		"import Home from './views/Home.pzl';\nconsole.log(Home);\n")

	b, err := NewWatchBuilder(root, WatchOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Dispose()
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial Rebuild: %v", err)
	}

	updated := strings.Replace(strings.ReplaceAll(viewTmpl, "%MARKER%", "UPDATED"),
		"color: red", "color: purple", 1)
	write(t, home, updated)
	publicFile := filepath.Join(root, "app", "public", "blocked", "asset.txt")
	if err := os.MkdirAll(filepath.Dir(publicFile), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, publicFile, "ASSET")
	// A file where copyPublic needs a directory makes the post-esbuild public
	// phase fail deterministically without permission assumptions.
	blockedTarget := filepath.Join(root, "dist", "blocked")
	write(t, blockedTarget, "not-a-directory")
	if _, err := b.Rebuild([]string{home, publicFile}); err == nil {
		t.Fatal("expected public sync to fail after the browser bundle")
	}
	if css := b.CSS(); strings.Contains(css, "purple") {
		t.Fatalf("post-bundle public failure committed candidate CSS:\n%s", css)
	}

	if err := os.Remove(blockedTarget); err != nil {
		t.Fatal(err)
	}
	result, err := b.Rebuild([]string{publicFile})
	if err != nil {
		t.Fatalf("public retry: %v", err)
	}
	if !result.BundleBuilt || !result.PublicSynced || !result.CSSChanged {
		t.Fatalf("public retry metadata = %+v, want complete pending retry", result)
	}
	if css := b.CSS(); !strings.Contains(css, "purple") {
		t.Fatalf("complete retry did not commit candidate CSS:\n%s", css)
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
