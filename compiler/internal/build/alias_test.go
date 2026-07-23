package build

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// aliasFixture is a working app whose every internal import uses the '@' app
// alias (SPEC §40, D75) instead of a relative path — including one from a nested
// view directory, the case the alias exists to fix ('../../components/…'). The
// deepest component carries a distinctive marker so its presence in the bundle
// proves the whole '@'-linked chain resolved.
//
// It reuses writeSSGFixture's file map (prerender_test.go) purely as a generic
// "materialize an app under the repo root" helper: the fixture must live INSIDE
// the checkout so findRuntime's walk-up resolves '@magic-spells/puzzle'.
func aliasFixture() ssgFixtureFiles {
	return ssgFixtureFiles{
		"app/app.js": `import { PuzzleApp } from '@magic-spells/puzzle';
import routes from '@/routes.js';
const app = new PuzzleApp({ target: '#app', routes });
app.mount();
export default app;
`,
		"app/routes.js": `import Deep from '@/views/deep/Deep.pzl';
import DefaultLayout from '@/layouts/Default.pzl';

export default [
  { path: '/', name: 'home', view: Deep, layout: DefaultLayout, meta: { title: 'Alias Page' } },
];
`,
		"app/layouts/Default.pzl": `<puzzle-view>
  <main><Slot/></main>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class DefaultLayout extends PuzzleView {}
</script>
`,
		// Two levels down: the relative spelling would be '../../components/…'.
		"app/views/deep/Deep.pzl": `<puzzle-view>
  <Widget/>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Widget from '@/components/Widget.pzl';
export default class Deep extends PuzzleView {}
</script>
`,
		"app/components/Widget.pzl": `<puzzle-view>
  <p>ALIAS_WIDGET_MARKER</p>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Widget extends PuzzleView {}
</script>
`,
		"app/public/index.html": `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Alias Shell</title></head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`,
	}
}

// TestBuildResolvesAppAlias is the integration run for the '@' app alias: a build
// of an app whose imports are all '@/…' succeeds and lands the aliased component
// in the bundle. It is simultaneously the regression guard for the runtime
// aliases — esbuild matches alias keys on SEGMENT boundaries, so a bare '@' key
// must not swallow '@magic-spells/puzzle'. Every .pzl in the fixture imports
// PuzzleView from it, so a broken boundary fails the build outright.
func TestBuildResolvesAppAlias(t *testing.T) {
	root := writeSSGFixture(t, aliasFixture())

	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("Build with '@' imports failed: %v", err)
	}

	appJS, err := os.ReadFile(filepath.Join(root, "dist", "app.js"))
	if err != nil {
		t.Fatal(err)
	}
	bundle := string(appJS)
	if !strings.Contains(bundle, "ALIAS_WIDGET_MARKER") {
		t.Errorf("bundle missing the component reached through '@/components/Widget.pzl'")
	}
	// Development builds leave identifiers intact, so the render assignments read
	// literally — proof the nested view resolved through '@/views/deep/…' too.
	if !strings.Contains(bundle, "Deep.prototype.render") {
		t.Errorf("bundle missing 'Deep.prototype.render' — '@/views/deep/Deep.pzl' did not resolve")
	}
	// The runtime came in through the untouched '@magic-spells/puzzle' specifier;
	// its dev-only HMR key is the cheapest proof it was actually bundled rather
	// than silently aliased somewhere odd.
	if !strings.Contains(bundle, "__puzzleHMR") {
		t.Errorf("bundle missing the runtime — the '@' alias must not capture '@magic-spells/puzzle'")
	}
}

// TestBuildHybridResolvesAppAlias covers the SECOND esbuild bundle: the hybrid
// build's prerender entry is assembled in prerender.go (bundlePrerenderEntry)
// with its own BuildOptions and only receives aliases through configureRuntime.
// If the '@' wiring ever regresses to the main bundle alone, the prerender
// bundle fails to resolve and this test catches it.
func TestBuildHybridResolvesAppAlias(t *testing.T) {
	requireSSGRuntime(t)
	root := writeSSGFixture(t, aliasFixture())

	if err := Build(root, Options{Development: true, Output: "hybrid"}); err != nil {
		t.Fatalf("hybrid Build with '@' imports failed: %v", err)
	}

	home := readFile(t, filepath.Join(root, "dist", "index.html"))
	if !strings.Contains(home, "ALIAS_WIDGET_MARKER") {
		t.Errorf("prerendered dist/index.html missing the '@'-imported component:\n%s", home)
	}
}
