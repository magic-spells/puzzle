package build

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/config"
)

// staticEquivalenceFixture is baseSSGFixture plus everything the equivalence
// sequence has to be able to mutate: a component with a <style> block, an
// {#svg}-inlined icon, and a couple of public assets.
func staticEquivalenceFixture() ssgFixtureFiles {
	files := baseSSGFixture()
	files["app/components/Card.pzl"] = `<puzzle-view>
  <section class="card"><span>{#svg 'icons/logo.svg'}</span><Children/></section>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Card extends PuzzleView {}
</script>
<style>
.card { color: rebeccapurple; }
</style>
`
	files["app/assets/icons/logo.svg"] = `<svg viewBox="0 0 24 24"><path d="M0 ORIGINAL"/></svg>`
	files["app/views/Home.pzl"] = `<puzzle-view>
  <h1>Home</h1>
  <Card>body</Card>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import Card from '../components/Card.pzl';
export default class Home extends PuzzleView {
  data() { return { greeting: 'hello' }; }
}
</script>
`
	files["app/public/robots.txt"] = "User-agent: *\n"
	files["app/public/assets/note.txt"] = "one\n"
	return files
}

// wantFull / wantRoutes describe the classification a step must produce, so the
// equivalence sequence proves the partial paths are actually TAKEN rather than
// quietly falling back to a full render everywhere (which would pass the
// byte-identity check while buying nothing).
type wantPlan struct {
	full   bool
	routes []string
}

func (w *wantPlan) check(t *testing.T, name string, got renderPlan) {
	t.Helper()
	if w == nil {
		return
	}
	if got.full != w.full {
		t.Errorf("%s: classified full=%v (%s), want full=%v", name, got.full, got.reason, w.full)
		return
	}
	if w.full {
		return
	}
	if strings.Join(got.routes, ",") != strings.Join(w.routes, ",") {
		t.Errorf("%s: rendered routes %v, want %v", name, got.routes, w.routes)
	}
}

// snapshotTree reads every file under dir into a path→contents map. Directories
// are represented only by the files inside them, which is what "the site a host
// would serve" means.
func snapshotTree(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = string(data)
		return nil
	})
	if err != nil {
		t.Fatalf("snapshotting %s: %v", dir, err)
	}
	return out
}

// diffTrees renders the first few differences between two snapshots.
func diffTrees(warm, oneShot map[string]string) string {
	var msgs []string
	names := map[string]bool{}
	for k := range warm {
		names[k] = true
	}
	for k := range oneShot {
		names[k] = true
	}
	sorted := make([]string, 0, len(names))
	for k := range names {
		sorted = append(sorted, k)
	}
	sort.Strings(sorted)
	for _, name := range sorted {
		w, inWarm := warm[name]
		o, inOne := oneShot[name]
		switch {
		case !inOne:
			msgs = append(msgs, fmt.Sprintf("only the dev rebuild produced %s", name))
		case !inWarm:
			msgs = append(msgs, fmt.Sprintf("only the one-shot build produced %s", name))
		case w != o:
			msgs = append(msgs, fmt.Sprintf("%s differs (dev %d bytes, one-shot %d bytes)\n  dev:      %.200q\n  one-shot: %.200q",
				name, len(w), len(o), w, o))
		}
		if len(msgs) >= 4 {
			break
		}
	}
	return strings.Join(msgs, "\n")
}

// TestStaticWatchBuilderMatchesOneShot is the contract this whole phase rests
// on: for every kind of edit a dev session sees, the incrementally rebuilt
// dist/ must be byte-for-byte what `puzzle build --static` would have produced
// from the same sources. Anything else means the site a developer clicks
// through in dev is not the site that ships.
func TestStaticWatchBuilderMatchesOneShot(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, staticEquivalenceFixture())

	write := func(rel, body string) {
		t.Helper()
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	remove := func(rel string) {
		t.Helper()
		if err := os.Remove(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			t.Fatal(err)
		}
	}
	abs := func(rel string) string { return filepath.Join(root, filepath.FromSlash(rel)) }

	builder, err := NewStaticWatchBuilder(root, StaticWatchOptions{Config: config.Config{Output: "static"}})
	if err != nil {
		t.Fatalf("creating the static dev builder: %v", err)
	}
	defer builder.Dispose()

	dist := filepath.Join(root, "dist")
	step := func(name string, changed []string, want *wantPlan, mutate func()) {
		t.Helper()
		if mutate != nil {
			mutate()
		}
		if err := builder.Rebuild(changed); err != nil {
			t.Fatalf("%s: dev rebuild failed: %v", name, err)
		}
		want.check(t, name, builder.lastPlan)
		warm := snapshotTree(t, dist)

		if err := Build(root, Options{Development: true, Output: "static"}); err != nil {
			t.Fatalf("%s: one-shot build failed: %v", name, err)
		}
		oneShot := snapshotTree(t, dist)

		if len(warm) == 0 {
			t.Fatalf("%s: the dev rebuild produced no output", name)
		}
		if d := diffTrees(warm, oneShot); d != "" {
			t.Errorf("%s: dev output is not the one-shot output:\n%s", name, d)
		}
	}

	step("initial", nil, &wantPlan{full: true}, nil)

	step("leaf .pzl edit", []string{abs("app/views/About.pzl")}, &wantPlan{routes: []string{"/about"}}, func() {
		write("app/views/About.pzl", `<puzzle-view>
  <h1>About, revised</h1>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class About extends PuzzleView {}
</script>
`)
	})

	step("component edit", []string{abs("app/components/Card.pzl")}, &wantPlan{routes: []string{"/"}}, func() {
		write("app/components/Card.pzl", `<puzzle-view>
  <section class="card"><span>{#svg 'icons/logo.svg'}</span><em>edited</em><Children/></section>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Card extends PuzzleView {}
</script>
<style>
.card { color: rebeccapurple; }
</style>
`)
	})

	step("style block edit", []string{abs("app/components/Card.pzl")}, &wantPlan{routes: []string{"/"}}, func() {
		write("app/components/Card.pzl", `<puzzle-view>
  <section class="card"><span>{#svg 'icons/logo.svg'}</span><em>edited</em><Children/></section>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Card extends PuzzleView {}
</script>
<style>
.card { color: seagreen; border: 1px solid; }
</style>
`)
	})

	step("public asset added", []string{abs("app/public/added.txt")}, &wantPlan{routes: []string{}}, func() {
		write("app/public/added.txt", "added\n")
	})

	step("public asset edited", []string{abs("app/public/assets/note.txt")}, &wantPlan{routes: []string{}}, func() {
		write("app/public/assets/note.txt", "two\n")
	})

	step("public asset deleted", []string{abs("app/public/added.txt")}, &wantPlan{routes: []string{}}, func() {
		remove("app/public/added.txt")
	})

	// The one edit a content-hash-keyed transform memo cannot see on its own:
	// the .pzl that inlines this icon is byte-identical across the change.
	step("inlined svg edit", []string{abs("app/assets/icons/logo.svg")}, &wantPlan{routes: []string{"/"}}, func() {
		write("app/assets/icons/logo.svg", `<svg viewBox="0 0 24 24"><path d="M0 REVISED"/></svg>`)
	})

	// The layout every route inherits: partial, but the partition is the whole
	// site. The catch-all's route path is '*', which sorts first.
	step("layout edit", []string{abs("app/layouts/Default.pzl")}, &wantPlan{routes: []string{"*", "/", "/about"}}, func() {
		write("app/layouts/Default.pzl", `<puzzle-view>
  <main class="shell"><Slot/></main>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class DefaultLayout extends PuzzleView {}
</script>
`)
	})

	// The shell is spliced into every page and belongs to no module graph.
	step("shell edit", []string{abs("app/public/index.html")}, &wantPlan{full: true}, func() {
		write("app/public/index.html", `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="generator" content="puzzle">
  <title>Fixture Shell</title>
  <link href="/styles.css" rel="stylesheet">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/app.js"></script>
</body>
</html>
`)
	})

	// app.js owns beforeMount, the store seed and the service wiring — it is in
	// the prerender graph and in no page's graph, so it can never be partial.
	step("app entry edit (render-wide)", []string{abs("app/app.js")}, &wantPlan{full: true}, func() {
		write("app/app.js", `import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
const app = new PuzzleApp({ target: '#app', routes });
app.mount();
export default app;
// touched
`)
	})

	// A stylesheet outside the module graph: styles.css is recomposed on every
	// rebuild anyway and no page's HTML embeds it, so nothing needs re-rendering.
	step("standalone css edit", []string{abs("app/styles/extra.css")}, &wantPlan{routes: []string{}}, func() {
		write("app/styles/extra.css", ".extra { color: red; }\n")
	})

	step(".pzl added with its route", []string{abs("app/views/Extra.pzl"), abs("app/routes.js")}, &wantPlan{full: true}, func() {
		write("app/views/Extra.pzl", `<puzzle-view>
  <h1>Extra</h1>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Extra extends PuzzleView {}
</script>
`)
		write("app/routes.js", `import Home from './views/Home.pzl';
import About from './views/About.pzl';
import Post from './views/Post.pzl';
import Extra from './views/Extra.pzl';
import NotFound from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  { path: '/', name: 'home', view: Home, layout: DefaultLayout, meta: { title: 'Home Page' } },
  { path: '/about', name: 'about', view: About, layout: DefaultLayout, meta: { title: 'About Page' } },
  { path: '/extra', name: 'extra', view: Extra, layout: DefaultLayout, meta: { title: 'Extra Page' } },
  { path: '/blog/:id', name: 'post', view: Post, layout: DefaultLayout, meta: { title: 'Post Page' } },
  { path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: 'Not Found Page' } },
];
`)
	})

	step("routes.js edit (route renamed)", []string{abs("app/routes.js")}, &wantPlan{full: true}, func() {
		write("app/routes.js", `import Home from './views/Home.pzl';
import About from './views/About.pzl';
import Post from './views/Post.pzl';
import Extra from './views/Extra.pzl';
import NotFound from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  { path: '/', name: 'home', view: Home, layout: DefaultLayout, meta: { title: 'Home Page' } },
  { path: '/about', name: 'about', view: About, layout: DefaultLayout, meta: { title: 'About Page' } },
  { path: '/bonus', name: 'bonus', view: Extra, layout: DefaultLayout, meta: { title: 'Bonus Page' } },
  { path: '/blog/:id', name: 'post', view: Post, layout: DefaultLayout, meta: { title: 'Post Page' } },
  { path: '*', name: 'not-found', view: NotFound, layout: DefaultLayout, meta: { title: 'Not Found Page' } },
];
`)
	})

	step(".pzl deleted with its route", []string{abs("app/views/Extra.pzl"), abs("app/routes.js")}, &wantPlan{full: true}, func() {
		write("app/routes.js", `import Home from './views/Home.pzl';
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
`)
		remove("app/views/Extra.pzl")
	})
}

// TestStaticWatchBuilderFailureKeepsLastGoodSite pins the D148 guarantee for the
// warm path: a compile error mid-session must not disturb the served site, and
// the next good save must recover it.
func TestStaticWatchBuilderFailureKeepsLastGoodSite(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, staticEquivalenceFixture())
	dist := filepath.Join(root, "dist")

	builder, err := NewStaticWatchBuilder(root, StaticWatchOptions{Config: config.Config{Output: "static"}})
	if err != nil {
		t.Fatalf("creating the static dev builder: %v", err)
	}
	defer builder.Dispose()

	if err := builder.Rebuild(nil); err != nil {
		t.Fatalf("initial rebuild failed: %v", err)
	}
	good := snapshotTree(t, dist)

	broken := filepath.Join(root, "app", "views", "About.pzl")
	if err := os.WriteFile(broken, []byte("<puzzle-view><h1>unclosed</puzzle-view>\n<script>\nexport default class About extends PuzzleView {\n</script>\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := builder.Rebuild([]string{broken}); err == nil {
		t.Fatal("a broken .pzl should fail the rebuild")
	}
	if after := snapshotTree(t, dist); diffTrees(after, good) != "" {
		t.Errorf("a failed rebuild changed the served site:\n%s", diffTrees(after, good))
	}

	// No orphaned staging trees: a failed rebuild cleans up after itself.
	entries, err := os.ReadDir(workTmp(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), stagingPrefix) {
			t.Errorf("failed rebuild left a staging tree behind: %s", e.Name())
		}
	}

	// Recovery: the next good save produces a working site again.
	if err := os.WriteFile(broken, []byte(`<puzzle-view>
  <h1>About, recovered</h1>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class About extends PuzzleView {}
</script>
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := builder.Rebuild([]string{broken}); err != nil {
		t.Fatalf("recovery rebuild failed: %v", err)
	}
	page, err := os.ReadFile(filepath.Join(dist, "about", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(page), "About, recovered") {
		t.Error("the recovered page did not reach dist/")
	}
}

// TestSameEntrySet covers the cheap route-set comparison that decides whether
// the per-page esbuild context has to be replaced.
func TestSameEntrySet(t *testing.T) {
	cases := []struct {
		name string
		a, b []string
		want bool
	}{
		{"identical", []string{"a", "b"}, []string{"a", "b"}, true},
		{"reordered", []string{"b", "a"}, []string{"a", "b"}, true},
		{"added", []string{"a"}, []string{"a", "b"}, false},
		{"removed", []string{"a", "b"}, []string{"a"}, false},
		{"renamed", []string{"a", "b"}, []string{"a", "c"}, false},
		{"both empty is never a match — there is no context to keep", nil, nil, false},
		{"empty vs one", nil, []string{"a"}, false},
	}
	for _, tt := range cases {
		if got := sameEntrySet(tt.a, tt.b); got != tt.want {
			t.Errorf("%s: sameEntrySet(%v, %v) = %v, want %v", tt.name, tt.a, tt.b, got, tt.want)
		}
	}
}

// TestStaticWatchPartialFallsBackWithoutLastGood pins the fallback discipline:
// a partial render is only ever a shortcut through artifacts that still exist.
// With the served tree gone there is nothing to reuse, so the rebuild must
// quietly become a full one rather than ship a site missing every page it did
// not re-render.
func TestStaticWatchPartialFallsBackWithoutLastGood(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, staticEquivalenceFixture())
	dist := filepath.Join(root, "dist")

	builder, err := NewStaticWatchBuilder(root, StaticWatchOptions{Config: config.Config{Output: "static"}})
	if err != nil {
		t.Fatalf("creating the static dev builder: %v", err)
	}
	defer builder.Dispose()

	if err := builder.Rebuild(nil); err != nil {
		t.Fatalf("initial rebuild failed: %v", err)
	}
	// The graph is warm now, so this edit would classify as one route…
	if err := os.WriteFile(filepath.Join(root, "app", "views", "About.pzl"), []byte(`<puzzle-view>
  <h1>About, again</h1>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class About extends PuzzleView {}
</script>
`), 0o644); err != nil {
		t.Fatal(err)
	}
	// …but with the last-good tree deleted, the pages it would have reused are
	// nowhere to be copied from.
	if err := os.RemoveAll(dist); err != nil {
		t.Fatal(err)
	}
	if err := builder.Rebuild([]string{filepath.Join(root, "app", "views", "About.pzl")}); err != nil {
		t.Fatalf("rebuild after losing dist/ failed: %v", err)
	}
	if !builder.lastPlan.full {
		t.Errorf("expected the rebuild to fall back to a full render, got routes %v", builder.lastPlan.routes)
	}
	warm := snapshotTree(t, dist)
	if err := Build(root, Options{Development: true, Output: "static"}); err != nil {
		t.Fatalf("one-shot build failed: %v", err)
	}
	if d := diffTrees(warm, snapshotTree(t, dist)); d != "" {
		t.Errorf("the fallback rebuild is not the one-shot output:\n%s", d)
	}
}

// TestStaticWatchPendingChangesSurviveAFailedRebuild covers the staleness hole
// route-level invalidation would otherwise have: the graph is only refreshed by
// a rebuild that SUCCEEDS, so an import added during a broken save must keep
// being classified until a graph that knows about it exists.
func TestStaticWatchPendingChangesSurviveAFailedRebuild(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, staticEquivalenceFixture())

	builder, err := NewStaticWatchBuilder(root, StaticWatchOptions{Config: config.Config{Output: "static"}})
	if err != nil {
		t.Fatalf("creating the static dev builder: %v", err)
	}
	defer builder.Dispose()
	if err := builder.Rebuild(nil); err != nil {
		t.Fatalf("initial rebuild failed: %v", err)
	}

	// A save that cannot build: routes.js is a render-wide module, so its change
	// is a full render — and it must still be pending after the failure.
	routes := filepath.Join(root, "app", "routes.js")
	original, err := os.ReadFile(routes)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(routes, []byte("import Missing from './views/Missing.pzl';\n"+string(original)), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := builder.Rebuild([]string{routes}); err == nil {
		t.Fatal("a routes.js importing a missing view should fail the rebuild")
	}

	// The next save touches only a leaf. On its own that is one route — but
	// routes.js is still pending, so the batch is a full render.
	if err := os.WriteFile(routes, original, 0o644); err != nil {
		t.Fatal(err)
	}
	leaf := filepath.Join(root, "app", "views", "About.pzl")
	if err := os.WriteFile(leaf, []byte(`<puzzle-view>
  <h1>About, third</h1>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class About extends PuzzleView {}
</script>
`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := builder.Rebuild([]string{leaf}); err != nil {
		t.Fatalf("recovery rebuild failed: %v", err)
	}
	if !builder.lastPlan.full {
		t.Errorf("a change batch carrying a failed save's render-wide edit must be full, got %v", builder.lastPlan.routes)
	}
}
