package build

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// requireSSGRuntime skips the calling test unless the JS SSG module the prerender
// step imports (client-runtime/ssg/index.js) exists. It is built concurrently by
// a separate agent; until it lands, the prerender bundle can't resolve
// @magic-spells/puzzle/ssg, so an integration run is not meaningful. Everything
// AROUND it (config parsing, flag wiring, the failure path's build-error
// surface) is still exercised by non-skipped tests.
func requireSSGRuntime(t *testing.T) {
	t.Helper()
	requireNodeBin(t)
	ssg := filepath.Join(repoRoot(t), "client-runtime", "ssg", "index.js")
	if _, err := os.Stat(ssg); err != nil {
		t.Skipf("SSG runtime not present yet (%s) — skipping the integration run", ssg)
	}
}

// requireStaticRuntime skips the calling test unless the JS static-pages kernel
// (client-runtime/static/index.js, mountStatic) exists — it is written
// concurrently by a separate agent. Until it lands, the per-page entries can't
// resolve @magic-spells/puzzle/static and the prerender pass can't run mode
// 'static', so a full static build is not meaningful. The Go-only pieces (config
// parsing, flag reconciliation, entry-file generation) are covered by
// non-skipped unit tests.
func requireStaticRuntime(t *testing.T) {
	t.Helper()
	requireNodeBin(t)
	kernel := filepath.Join(repoRoot(t), "client-runtime", "static", "index.js")
	if _, err := os.Stat(kernel); err != nil {
		t.Skipf("static kernel not present yet (%s) — skipping the integration run", kernel)
	}
}

func requireNodeBin(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
}

// ssgFixtureFiles is the file set a fixture app is materialized from: a small
// routes.js (two static routes + one dynamic :id route), an app.js that
// `export default app`s, a trivial layout + views, and a public/index.html shell
// with an empty #app target and a <title>.
type ssgFixtureFiles map[string]string

// writeSSGFixture materializes files under a fresh temp dir INSIDE the repo, so
// findRuntime's walk-up resolves the in-repo client-runtime (an app under the OS
// temp root could not). The whole tree is removed on cleanup.
func writeSSGFixture(t *testing.T, files ssgFixtureFiles) string {
	t.Helper()
	root, err := os.MkdirTemp(repoRoot(t), ".ssg-fixture-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(root) })
	for rel, body := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// baseSSGFixture is a working static-capable app: '/' and '/about' are static,
// '/blog/:id' is dynamic (v1 skips it), and '*' is the top-level catch-all
// (rendered to dist/404.html). Each route carries a distinct meta.title.
func baseSSGFixture() ssgFixtureFiles {
	return ssgFixtureFiles{
		"app/app.js": `import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
const app = new PuzzleApp({ target: '#app', routes });
app.mount();
export default app;
`,
		"app/routes.js": `import Home from './views/Home.pzl';
import About from './views/About.pzl';
import Post from './views/Post.pzl';
import NotFound from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  { path: '/', name: 'home', view: Home, layout: DefaultLayout, meta: { title: 'Home Page' } },
  { path: '/about', name: 'about', view: About, layout: DefaultLayout, meta: { title: 'About Page' } },
  { path: '/blog/:id', name: 'post', view: Post, layout: DefaultLayout, meta: { title: 'Post Page' } },
  { path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: 'Not Found Page' } },
];
`,
		"app/layouts/Default.pzl": `<puzzle-view>
  <main><Slot/></main>
</puzzle-view>
<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class DefaultLayout extends PuzzleView {}
</scripts>
`,
		"app/views/Home.pzl": `<puzzle-view>
  <h1>Home</h1>
</puzzle-view>
<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  data() { return { greeting: 'hello' }; }
}
</scripts>
`,
		"app/views/About.pzl": `<puzzle-view>
  <h1>About</h1>
</puzzle-view>
<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class About extends PuzzleView {}
</scripts>
`,
		"app/views/Post.pzl": `<puzzle-view>
  <h1>Post</h1>
</puzzle-view>
<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Post extends PuzzleView {}
</scripts>
`,
		"app/views/NotFound.pzl": `<puzzle-view>
  <h1>Not Found</h1>
</puzzle-view>
<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class NotFound extends PuzzleView {}
</scripts>
`,
		"app/public/index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Fixture Shell</title>
  <link href="/styles.css" rel="stylesheet">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`,
	}
}

// TestBuildHybridEmitsPerRouteHTML is the integration run for the HYBRID mode
// (formerly 'static'): an Output:"hybrid" build of a fixture app writes one
// index.html per STATIC route (directory style), each carrying the SSG takeover
// marker (data-puzzle-ssg) and its route's <title>; the dynamic :id route is
// skipped; and the .puzzle-prerender/ bundle never ships in dist/. It asserts
// today's behavior is byte-for-byte unchanged under the new name. Skipped until
// the JS SSG runtime lands.
func TestBuildHybridEmitsPerRouteHTML(t *testing.T) {
	requireSSGRuntime(t)
	root := writeSSGFixture(t, baseSSGFixture())

	// Capture stdout across the build: the summary line must report the REAL
	// written-page count — it regressed to "0 pages" once when the Go summary
	// struct and the JS prerenderToDir return shape disagreed on the key name.
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	buildErr := Build(root, Options{Development: true, Output: "hybrid"})
	w.Close()
	os.Stdout = oldStdout
	captured, _ := io.ReadAll(r)
	if buildErr != nil {
		t.Fatalf("static Build failed: %v", buildErr)
	}
	if !strings.Contains(string(captured), "3 pages prerendered") {
		t.Errorf("build summary should report '3 pages prerendered', got:\n%s", captured)
	}
	if !strings.Contains(string(captured), "puzzle build · hybrid") {
		t.Errorf("hybrid build summary header should read 'puzzle build · hybrid', got:\n%s", captured)
	}
	dist := filepath.Join(root, "dist")

	// Home ('/') → dist/index.html; About → dist/about/index.html.
	home := readFile(t, filepath.Join(dist, "index.html"))
	if !strings.Contains(home, "data-puzzle-ssg") {
		t.Errorf("dist/index.html missing the data-puzzle-ssg takeover marker:\n%s", home)
	}
	if !strings.Contains(home, "Home Page") {
		t.Errorf("dist/index.html missing the route <title> 'Home Page':\n%s", home)
	}

	about := readFile(t, filepath.Join(dist, "about", "index.html"))
	if !strings.Contains(about, "data-puzzle-ssg") {
		t.Errorf("dist/about/index.html missing the data-puzzle-ssg marker:\n%s", about)
	}
	if !strings.Contains(about, "About Page") {
		t.Errorf("dist/about/index.html missing the route <title> 'About Page':\n%s", about)
	}

	// The catch-all ('*') renders to dist/404.html (the static-host convention),
	// not a directory-style dist/*/index.html.
	notFound := readFile(t, filepath.Join(dist, "404.html"))
	if !strings.Contains(notFound, "data-puzzle-ssg") {
		t.Errorf("dist/404.html missing the data-puzzle-ssg marker:\n%s", notFound)
	}
	if !strings.Contains(notFound, "Not Found Page") {
		t.Errorf("dist/404.html missing the route <title> 'Not Found Page':\n%s", notFound)
	}

	// The dynamic route is skipped in v1 — no dist/blog/ tree is written.
	if _, err := os.Stat(filepath.Join(dist, "blog")); !os.IsNotExist(err) {
		t.Errorf("dynamic route should be skipped; dist/blog exists (err=%v)", err)
	}

	// The prerender bundle must not ship.
	if _, err := os.Stat(filepath.Join(dist, prerenderDir)); !os.IsNotExist(err) {
		t.Errorf("%s must be deleted before the swap; it survived in dist/ (err=%v)", prerenderDir, err)
	}

	// The shared SPA payload is still present alongside the prerendered pages.
	for _, f := range []string{"app.js", "styles.css"} {
		if _, err := os.Stat(filepath.Join(dist, f)); err != nil {
			t.Errorf("expected dist/%s alongside prerendered HTML: %v", f, err)
		}
	}
}

// TestBuildHybridViaConfig proves output: 'hybrid' in puzzle.config.js enables
// the takeover prerender step WITHOUT any flag (Options.Output=="").
func TestBuildHybridViaConfig(t *testing.T) {
	requireSSGRuntime(t)
	files := baseSSGFixture()
	files["puzzle.config.js"] = "export default { output: 'hybrid' };\n"
	root := writeSSGFixture(t, files)

	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("config-driven hybrid Build failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "dist", "about", "index.html")); err != nil {
		t.Errorf("output:'hybrid' should prerender routes without a flag; dist/about/index.html missing: %v", err)
	}
}

// TestBuildStaticPrerenderFailureLeavesDistIntact proves a prerender failure (a
// route whose data() throws) fails the build AND leaves the previous good dist/
// exactly as it was — the same atomic-swap guarantee compile failures get.
func TestBuildStaticPrerenderFailureLeavesDistIntact(t *testing.T) {
	requireSSGRuntime(t)

	// First: a clean SPA build (no prerender) populates dist/ with a marker.
	files := baseSSGFixture()
	root := writeSSGFixture(t, files)
	if err := Build(root, Options{Development: true}); err != nil {
		t.Fatalf("first (SPA) Build failed: %v", err)
	}
	dist := filepath.Join(root, "dist")
	before := readFile(t, filepath.Join(dist, "index.html"))

	// Break the Home view's data() so the prerender run throws for '/'.
	broken := `<puzzle-view>
  <h1>Home</h1>
</puzzle-view>
<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  data() { throw new Error('BOOM_FROM_DATA'); }
}
</scripts>
`
	if err := os.WriteFile(filepath.Join(root, "app", "views", "Home.pzl"), []byte(broken), 0o644); err != nil {
		t.Fatal(err)
	}

	// A --hybrid build must now FAIL...
	err := Build(root, Options{Development: true, Output: "hybrid"})
	if err == nil {
		t.Fatal("expected the hybrid Build to fail on the throwing data()")
	}

	// ...and the previous good dist/index.html must be byte-identical.
	after := readFile(t, filepath.Join(dist, "index.html"))
	if after != before {
		t.Errorf("dist/index.html changed despite the failed static build:\nbefore=%q\nafter=%q", before, after)
	}

	// No staging or prerender leftovers under the app root.
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".dist-staging-") {
			t.Errorf("leftover staging dir after failed static build: %s", e.Name())
		}
	}
}

// TestBuildInvalidOutputConfigFailsBuild proves an unsupported output value
// fails the build up front (at config load) — no runtime/SSG module needed, so
// this runs whenever node is available.
func TestBuildInvalidOutputConfigFailsBuild(t *testing.T) {
	requireNodeBin(t)
	files := baseSSGFixture()
	files["puzzle.config.js"] = "export default { output: 'server' };\n"
	root := writeSSGFixture(t, files)

	err := Build(root, Options{Development: true})
	if err == nil {
		t.Fatal("expected Build to fail for an unsupported output value")
	}
	if !strings.Contains(err.Error(), "output") || !strings.Contains(err.Error(), "static") {
		t.Errorf("error should name output and the allowed value 'static', got: %v", err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	return string(data)
}
