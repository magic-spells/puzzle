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
	step := func(name string, changed []string, mutate func()) {
		t.Helper()
		if mutate != nil {
			mutate()
		}
		if err := builder.Rebuild(changed); err != nil {
			t.Fatalf("%s: dev rebuild failed: %v", name, err)
		}
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

	step("initial", nil, nil)

	step("leaf .pzl edit", []string{abs("app/views/About.pzl")}, func() {
		write("app/views/About.pzl", `<puzzle-view>
  <h1>About, revised</h1>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class About extends PuzzleView {}
</script>
`)
	})

	step("component edit", []string{abs("app/components/Card.pzl")}, func() {
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

	step("style block edit", []string{abs("app/components/Card.pzl")}, func() {
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

	step("public asset added", []string{abs("app/public/added.txt")}, func() {
		write("app/public/added.txt", "added\n")
	})

	step("public asset edited", []string{abs("app/public/assets/note.txt")}, func() {
		write("app/public/assets/note.txt", "two\n")
	})

	step("public asset deleted", []string{abs("app/public/added.txt")}, func() {
		remove("app/public/added.txt")
	})

	// The one edit a content-hash-keyed transform memo cannot see on its own:
	// the .pzl that inlines this icon is byte-identical across the change.
	step("inlined svg edit", []string{abs("app/assets/icons/logo.svg")}, func() {
		write("app/assets/icons/logo.svg", `<svg viewBox="0 0 24 24"><path d="M0 REVISED"/></svg>`)
	})

	step(".pzl added with its route", []string{abs("app/views/Extra.pzl"), abs("app/routes.js")}, func() {
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

	step("routes.js edit (route renamed)", []string{abs("app/routes.js")}, func() {
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

	step(".pzl deleted with its route", []string{abs("app/views/Extra.pzl"), abs("app/routes.js")}, func() {
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
