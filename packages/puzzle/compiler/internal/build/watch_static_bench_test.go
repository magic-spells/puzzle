package build

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/magic-spells/puzzle/compiler/internal/config"
)

// bodyBlocks is how many prose sections each generated view renders. A one-
// element view made the fixture render 148 pages in under 100ms, which is two
// orders of magnitude faster per page than the reference deployment's docs
// pages and made the render phase — the thing route-level invalidation exists
// to skip — disappear into node's startup cost. Twelve blocks puts a generated
// page in the same order of magnitude as a real one.
const bodyBlocks = 12

// largeStaticFixture generates a site in the shape of the reference deployment:
// routes routes, each with its own view, plus a shared component library the
// views import, so the .pzl count lands near 250 and the module graph is wide
// rather than deep.
func largeStaticFixture(routes, components int) ssgFixtureFiles {
	files := ssgFixtureFiles{
		"app/app.js": `import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
const app = new PuzzleApp({ target: '#app', routes });
app.mount();
export default app;
`,
		"app/layouts/Default.pzl": `<puzzle-view>
  <main><Slot/></main>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class DefaultLayout extends PuzzleView {}
</script>
`,
		"app/public/index.html": `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Bench Shell</title><link href="/styles.css" rel="stylesheet"></head>
<body><div id="app"></div><script type="module" src="/app.js"></script></body>
</html>
`,
	}

	for i := 0; i < components; i++ {
		files[fmt.Sprintf("app/components/C%03d.pzl", i)] = fmt.Sprintf(`<puzzle-view>
  <span class="c%03d">component %d<Children/></span>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class C%03d extends PuzzleView {}
</script>
<style>
.c%03d { color: #%03x; }
</style>
`, i, i, i, i, i*7%4096)
	}

	var imports, entries strings.Builder
	imports.WriteString("import DefaultLayout from './layouts/Default.pzl';\n")
	for i := 0; i < routes; i++ {
		a, b := i%components, (i*3+1)%components
		var body strings.Builder
		for s := 0; s < bodyBlocks; s++ {
			fmt.Fprintf(&body, `
    <section class="block b%d">
      <h2>Section %d</h2>
      <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.</p>
      <ul><li>one</li><li>two</li><li>three</li><li>four</li></ul>
      <pre><code>const x = %d;</code></pre>
    </section>`, s, s, s)
		}
		files[fmt.Sprintf("app/views/V%03d.pzl", i)] = fmt.Sprintf(`<puzzle-view>
  <article>
    <h1>Page %d</h1>
    <A>alpha</A>
    <B>beta</B>
    <p>{ label }</p>`+body.String()+`
  </article>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import A from '../components/C%03d.pzl';
import B from '../components/C%03d.pzl';
export default class V%03d extends PuzzleView {
  data() { return { label: 'page %d' }; }
}
</script>
`, i, a, b, i, i)
		fmt.Fprintf(&imports, "import V%03d from './views/V%03d.pzl';\n", i, i)
		if i == 0 {
			fmt.Fprintf(&entries, "  { path: '/', name: 'v%03d', view: V%03d, layout: DefaultLayout },\n", i, i)
			continue
		}
		fmt.Fprintf(&entries, "  { path: '/p%03d', name: 'v%03d', view: V%03d, layout: DefaultLayout },\n", i, i, i)
	}
	files["app/routes.js"] = imports.String() + "\nexport default [\n" + entries.String() + "];\n"
	return files
}

// TestStaticDevRebuildTiming is a measurement, not an assertion: it reports the
// median save-to-swap of the persistent builder against the cold one-shot build
// it replaces, on a site the size of the reference deployment. It is off by
// default (it takes tens of seconds) — run it with PUZZLE_BENCH_STATIC_DEV=1.
func TestStaticDevRebuildTiming(t *testing.T) {
	if os.Getenv("PUZZLE_BENCH_STATIC_DEV") == "" {
		t.Skip("set PUZZLE_BENCH_STATIC_DEV=1 to run the static dev rebuild timing")
	}
	requireStaticRuntime(t)

	routes, components := 148, 100
	files := largeStaticFixture(routes, components)
	root := writeSSGFixture(t, files)
	t.Logf("fixture: %d routes, %d .pzl files", routes, routes+components+1)

	// The edit under test: a leaf view's template, the commonest dev save.
	leaf := filepath.Join(root, "app", "views", "V007.pzl")
	edit := func(n int) {
		body := fmt.Sprintf(`<puzzle-view>
  <article>
    <h1>Page 7 rev %d</h1>
    <A>alpha</A>
    <B>beta</B>
    <p>{ label }</p>
  </article>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
import A from '../components/C007.pzl';
import B from '../components/C022.pzl';
export default class V007 extends PuzzleView {
  data() { return { label: 'page 7 rev %d' }; }
}
</script>
`, n, n)
		if err := os.WriteFile(leaf, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	median := func(ds []time.Duration) time.Duration {
		sort.Slice(ds, func(i, j int) bool { return ds[i] < ds[j] })
		return ds[len(ds)/2]
	}

	// Before: what a save cost until this phase — a complete cold build.Build.
	if err := Build(root, Options{Development: true, Output: "static"}); err != nil {
		t.Fatalf("warm-up one-shot build: %v", err)
	}
	var cold []time.Duration
	for i := 0; i < 5; i++ {
		edit(i)
		start := time.Now()
		if err := Build(root, Options{Development: true, Output: "static"}); err != nil {
			t.Fatalf("one-shot rebuild %d: %v", i, err)
		}
		cold = append(cold, time.Since(start))
	}

	// After: the persistent builder.
	builder, err := NewStaticWatchBuilder(root, StaticWatchOptions{Config: config.Config{Output: "static"}})
	if err != nil {
		t.Fatal(err)
	}
	defer builder.Dispose()
	if err := builder.Rebuild(nil); err != nil {
		t.Fatalf("warm-up dev rebuild: %v", err)
	}
	// The warm builder with route-level invalidation OFF: an empty change list is
	// the classifier's "I know nothing" state, so every route is re-rendered.
	// This is what a save cost after D154 and before D155.
	var warmFull []time.Duration
	for i := 0; i < 5; i++ {
		edit(100 + i)
		start := time.Now()
		if err := builder.Rebuild(nil); err != nil {
			t.Fatalf("dev full rebuild %d: %v", i, err)
		}
		if !builder.lastPlan.full {
			t.Fatalf("dev full rebuild %d did not render everything", i)
		}
		warmFull = append(warmFull, time.Since(start))
	}

	// And with it on: the same leaf edit, classified down to the one route that
	// can observe it.
	var warm []time.Duration
	for i := 0; i < 5; i++ {
		edit(200 + i)
		start := time.Now()
		if err := builder.Rebuild([]string{leaf}); err != nil {
			t.Fatalf("dev rebuild %d: %v", i, err)
		}
		if builder.lastPlan.full || len(builder.lastPlan.routes) != 1 {
			t.Fatalf("dev rebuild %d classified as %+v, want one route", i, builder.lastPlan)
		}
		warm = append(warm, time.Since(start))
	}

	t.Logf("cold build.Build per save:        median %v  (all: %v)", median(cold), cold)
	t.Logf("StaticWatchBuilder, full render:  median %v  (all: %v)", median(warmFull), warmFull)
	t.Logf("StaticWatchBuilder, 1/%d routes:  median %v  (all: %v)", routes, median(warm), warm)
}
