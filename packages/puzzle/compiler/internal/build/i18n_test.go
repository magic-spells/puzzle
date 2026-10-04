package build

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/magic-spells/puzzle/compiler/internal/config"
	"github.com/magic-spells/puzzle/compiler/internal/locales"
	"github.com/magic-spells/puzzle/compiler/internal/plugin"
)

// i18nMarkers are string literals unique to client-runtime/i18n.js — the island
// selector and the storage key. Both survive minification, so their absence
// from a bundle is real evidence the module tree-shook away (D89's literal rule).
var i18nMarkers = []string{"data-puzzle-locale", "__puzzleLocale"}

var enI18n = &config.I18n{Locales: []string{"en", "es"}, DefaultLocale: "en"}

// i18nFixture is baseSSGFixture plus two locale files and a view that passes a
// literal key to `t`.
func i18nFixture() ssgFixtureFiles {
	files := baseSSGFixture()
	files["app/locales/en.json"] = `{ "home": { "title": "Welcome" }, "items": { "one": "{count} item", "other": "{count} items" } }`
	files["app/locales/es.json"] = `{ "home": { "title": "Bienvenido" } }`
	files["app/views/Home.pzl"] = `<puzzle-view>
  <h1>{ t('home.title') }</h1>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {}
</script>
`
	return files
}

func localeFiles(t *testing.T, dist string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(dist, "locales"))
	if err != nil {
		t.Fatalf("reading dist/locales: %v", err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

var hashedLocale = regexp.MustCompile(`^(en|es)\.[A-Z2-7]{8}\.json$`)

// TestBuildI18nEmitsOneFilePerLocale: a production SPA build with i18n writes
// exactly one hashed file per locale, bakes the manifest paths into app.js, and
// keeps the i18n runtime.
func TestBuildI18nEmitsOneFilePerLocale(t *testing.T) {
	root := writeSSGFixture(t, i18nFixture())
	cfg := config.Config{I18n: enI18n}
	if err := Build(root, Options{Config: &cfg}); err != nil {
		t.Fatalf("Build: %v", err)
	}
	dist := filepath.Join(root, "dist")
	names := localeFiles(t, dist)
	if len(names) != 2 {
		t.Fatalf("dist/locales = %v, want exactly one file per locale", names)
	}
	appJS := readFile(t, filepath.Join(dist, "app.js"))
	for _, name := range names {
		if !hashedLocale.MatchString(name) {
			t.Errorf("%s is not <tag>.<hash>.json", name)
		}
		if !strings.Contains(appJS, "locales/"+name) {
			t.Errorf("app.js does not reference its manifest path locales/%s", name)
		}
	}
	for _, marker := range i18nMarkers {
		if !strings.Contains(appJS, marker) {
			t.Errorf("an i18n bundle lost %q", marker)
		}
	}
	// es was filled from en at build time.
	for _, name := range names {
		if strings.HasPrefix(name, "es.") {
			es := readFile(t, filepath.Join(dist, "locales", name))
			if !strings.Contains(es, `"items":{"one":"{count} item","other":"{count} items"}`) || !strings.Contains(es, "Bienvenido") {
				t.Errorf("es table not filled from en: %s", es)
			}
		}
	}
}

// TestBuildWithoutI18nShipsNoI18n: the same app without the config block ships
// none of the i18n runtime and emits no locales/ (the zero-cost path).
func TestBuildWithoutI18nShipsNoI18n(t *testing.T) {
	root := writeSSGFixture(t, baseSSGFixture())
	cfg := config.Config{}
	if err := Build(root, Options{Config: &cfg}); err != nil {
		t.Fatalf("Build: %v", err)
	}
	appJS := readFile(t, filepath.Join(root, "dist", "app.js"))
	for _, marker := range i18nMarkers {
		if strings.Contains(appJS, marker) {
			t.Errorf("a bundle without i18n retained %q", marker)
		}
	}
	if _, err := os.Stat(filepath.Join(root, "dist", "locales")); !os.IsNotExist(err) {
		t.Errorf("dist/locales must not exist without i18n (err=%v)", err)
	}
}

// TestBuildI18nBadLocaleKeepsLastGoodDist: a locale error fails the build
// before dist/ is touched.
func TestBuildI18nBadLocaleKeepsLastGoodDist(t *testing.T) {
	root := writeSSGFixture(t, i18nFixture())
	cfg := config.Config{I18n: enI18n}
	if err := Build(root, Options{Config: &cfg}); err != nil {
		t.Fatalf("Build: %v", err)
	}
	before := readFile(t, filepath.Join(root, "dist", "app.js"))
	write(t, filepath.Join(root, "app", "locales", "es.json"), `{ "home": { "title": 3 } }`)
	err := Build(root, Options{Config: &cfg})
	if err == nil || !strings.Contains(err.Error(), `"home.title": a translation must be a string`) {
		t.Fatalf("expected a positioned locale error, got %v", err)
	}
	if after := readFile(t, filepath.Join(root, "dist", "app.js")); after != before {
		t.Fatal("a failed locale load must leave the last good dist/ in place")
	}
}

func TestValidatePublicReservesLocalesWithI18n(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "app", "public", "locales"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePublic(root, false, nil); err != nil {
		t.Fatalf("locales/ belongs to the app without i18n: %v", err)
	}
	err := ValidatePublic(root, false, enI18n)
	if err == nil || !strings.Contains(err.Error(), "dist/locales") {
		t.Fatalf("expected a reserved-name error, got %v", err)
	}
}

// TestValidatePublicReservesLocalePrefixes: under prefix routing (D177) a
// top-level public entry — folder or file — named after a non-default locale
// collides with that locale's dist/<tag>/ pages, case-insensitively. The
// default locale's tag, nested entries, and apps without routing are untouched.
func TestValidatePublicReservesLocalePrefixes(t *testing.T) {
	prefix := &config.I18n{Locales: []string{"en", "es", "pt-BR"}, DefaultLocale: "en", Routing: config.RoutingPrefix}
	for _, tc := range []struct {
		name  string
		dir   bool
		clash string
	}{
		{"es", true, "/es/"},
		{"ES", true, "/es/"},
		{"pt-br", false, "/pt-BR/"},
		{"en", true, ""},
		{"esp", true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			pub := filepath.Join(root, "app", "public")
			if tc.dir {
				if err := os.MkdirAll(filepath.Join(pub, tc.name, "nested"), 0o755); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.MkdirAll(pub, 0o755); err != nil {
					t.Fatal(err)
				}
				write(t, filepath.Join(pub, tc.name), "x")
			}
			if err := ValidatePublic(root, false, enI18n); err != nil {
				t.Fatalf("without routing %s belongs to the app: %v", tc.name, err)
			}
			err := ValidatePublic(root, false, prefix)
			if tc.clash == "" {
				if err != nil {
					t.Fatalf("%s must not collide: %v", tc.name, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.clash) || !strings.Contains(err.Error(), tc.name) {
				t.Fatalf("expected a %s prefix collision naming %s, got %v", tc.clash, tc.name, err)
			}
		})
	}
}

func TestI18nWarnings(t *testing.T) {
	root := t.TempDir()
	usage := plugin.Usage{Formatters: map[string]bool{"t": true}, TKeys: map[string][]string{
		"home.titel": {"app/views/Home.pzl"},
		"home.title": {"app/views/Home.pzl"},
		"zzz":        {"app/views/A.pzl", "app/views/B.pzl"},
	}}

	// Without i18n: `t` used, and an app/locales folder.
	got := i18nWarnings(root, config.Config{}, usage, nil)
	if len(got) != 1 || !strings.Contains(got[0], "configures no i18n") || !strings.Contains(got[0], "unless the app registers its own t formatter") {
		t.Fatalf("t without i18n: %q", got)
	}
	if err := os.MkdirAll(filepath.Join(root, "app", "locales"), 0o755); err != nil {
		t.Fatal(err)
	}
	got = i18nWarnings(root, config.Config{}, plugin.Usage{Formatters: map[string]bool{}}, nil)
	if len(got) != 1 || !strings.Contains(got[0], "app/locales/ exists") {
		t.Fatalf("locales without i18n: %q", got)
	}

	// With i18n: a literal key missing from the default locale, with a did-you-mean.
	res := &locales.Result{
		Manifest:    locales.Manifest{DefaultLocale: "en"},
		DefaultKeys: map[string]bool{"home.title": true},
		Warnings:    []string{"es: 1 key missing, filled from en (x)"},
	}
	got = i18nWarnings(root, config.Config{I18n: enI18n}, usage, res)
	want := []string{
		"es: 1 key missing, filled from en (x)",
		`app/views/Home.pzl: t key "home.titel" is not in app/locales/en.json (did you mean "home.title"?) — it will print as written`,
		`app/views/A.pzl, app/views/B.pzl: t key "zzz" is not in app/locales/en.json — it will print as written`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("warnings:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// TestI18nRoutingWarnings: the scan's root-relative hrefs become positioned
// warnings only under prefix routing, sorted by position (D177); detect set
// without routing warns that it does nothing.
func TestI18nRoutingWarnings(t *testing.T) {
	root := t.TempDir()
	res := &locales.Result{Manifest: locales.Manifest{DefaultLocale: "en"}}
	usage := plugin.Usage{Formatters: map[string]bool{}, RootHrefs: []plugin.RootHref{
		{File: "app/views/Z.pzl", Line: 1, Col: 4, Href: "/z"},
		{File: "app/views/A.pzl", Line: 9, Col: 2, Href: "/blog/", Mixed: true},
		{File: "app/views/A.pzl", Line: 3, Col: 7, Href: "/it's"},
	}}
	if got := i18nWarnings(root, config.Config{I18n: enI18n}, usage, res); len(got) != 0 {
		t.Fatalf("no routing must print no href warning: %q", got)
	}

	prefix := &config.I18n{Locales: []string{"en", "es"}, DefaultLocale: "en", Routing: config.RoutingPrefix}
	got := i18nWarnings(root, config.Config{I18n: prefix}, usage, res)
	want := []string{
		`app/views/A.pzl:3:7: href="/it's" skips the locale prefix, so it always opens the default-language page under i18n.routing: 'prefix' — write href={ link('/it\'s') }, or link('/it\'s', { locale: false }) for a file that exists once`,
		`app/views/A.pzl:9:2: href="/blog/…" skips the locale prefix, so it always opens the default-language page under i18n.routing: 'prefix' — build it with link() — link(path), or link(path, { locale: false }) for a file that exists once`,
		`app/views/Z.pzl:1:4: href="/z" skips the locale prefix, so it always opens the default-language page under i18n.routing: 'prefix' — write href={ link('/z') }, or link('/z', { locale: false }) for a file that exists once`,
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("warnings:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}

	off := false
	detectOnly := &config.I18n{Locales: []string{"en"}, DefaultLocale: "en", Detect: &off}
	got = i18nWarnings(root, config.Config{I18n: detectOnly}, plugin.Usage{Formatters: map[string]bool{}}, res)
	if len(got) != 1 || !strings.Contains(got[0], "i18n.detect has no effect without i18n.routing: 'prefix'") {
		t.Fatalf("detect without routing: %q", got)
	}
	prefix.Detect = &off
	if got := i18nWarnings(root, config.Config{I18n: prefix}, plugin.Usage{Formatters: map[string]bool{}}, res); len(got) != 0 {
		t.Fatalf("detect with routing is meaningful: %q", got)
	}
}

// TestLocaleRoutingDefine: __PUZZLE_HAS_LOCALE_ROUTING__ is true only under
// prefix routing, and every pass's plugin carries it (the app, prerender and
// page passes all build theirs through passContext.plugin and bundleDefines).
func TestLocaleRoutingDefine(t *testing.T) {
	root := t.TempDir()
	prefix := &config.I18n{Locales: []string{"en", "es"}, DefaultLocale: "en", Routing: config.RoutingPrefix}
	for _, tc := range []struct {
		i18n       *config.I18n
		i18nOn, on string
	}{
		{nil, "false", "false"},
		{enI18n, "true", "false"},
		{prefix, "true", "true"},
	} {
		pc := &passContext{cache: plugin.NewCompileCache(), i18n: tc.i18n}
		for _, flags := range []bundleFlags{{}, {Takeover: true, Capture: true}} {
			d := bundleDefines(pc.plugin(root), flags)
			if d["__PUZZLE_HAS_I18N__"] != tc.i18nOn || d["__PUZZLE_HAS_LOCALE_ROUTING__"] != tc.on {
				t.Errorf("i18n %+v: HAS_I18N=%s HAS_LOCALE_ROUTING=%s, want %s/%s",
					tc.i18n, d["__PUZZLE_HAS_I18N__"], d["__PUZZLE_HAS_LOCALE_ROUTING__"], tc.i18nOn, tc.on)
			}
		}
	}
}

// TestBuildStaticI18n: static output prerenders in the default locale, carries
// the island on every page, and ships the locale files.
func TestBuildStaticI18n(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, i18nFixture())
	cfg := config.Config{Output: "static", I18n: enI18n}
	if err := Build(root, Options{Config: &cfg, Development: true}); err != nil {
		t.Fatalf("static Build: %v", err)
	}
	dist := filepath.Join(root, "dist")
	home := readFile(t, filepath.Join(dist, "index.html"))
	if !strings.Contains(home, "<h1>Welcome</h1>") {
		t.Errorf("home not prerendered in the default locale:\n%s", home)
	}
	if !strings.Contains(home, `<script type="application/json" data-puzzle-locale="en">`) {
		t.Errorf("home missing the locale island:\n%s", home)
	}
	if len(localeFiles(t, dist)) != 2 {
		t.Errorf("static output must ship one file per locale")
	}
	pages := staticPageBundleSources(t, dist)
	if !strings.Contains(pages, "data-puzzle-locale") {
		t.Error("static page bundles lost the i18n runtime")
	}
}

// TestBuildStaticLocaleRouting: a static build with prefix routing and a site
// stays green while the JS half is unbuilt, and its page bundles carry the
// manifest's routing field (D177); without routing that field is absent.
func TestBuildStaticLocaleRouting(t *testing.T) {
	requireStaticRuntime(t)
	routingField := regexp.MustCompile(`"?routing"?:\s*"prefix"`)
	for _, on := range []bool{false, true} {
		root := writeSSGFixture(t, i18nFixture())
		i18n := *enI18n
		if on {
			i18n.Routing = config.RoutingPrefix
		}
		cfg := config.Config{Output: "static", I18n: &i18n, Site: "https://example.com"}
		if err := Build(root, Options{Config: &cfg, Development: true}); err != nil {
			t.Fatalf("static Build (routing %v): %v", on, err)
		}
		dist := filepath.Join(root, "dist")
		if home := readFile(t, filepath.Join(dist, "index.html")); !strings.Contains(home, "<h1>Welcome</h1>") {
			t.Errorf("routing %v: home not prerendered:\n%s", on, home)
		}
		if got := routingField.MatchString(staticPageBundleSources(t, dist)); got != on {
			t.Errorf("routing %v: page bundles carry the routing field = %v", on, got)
		}
	}
}

// TestBuildHybridI18n: hybrid output prerenders in the default locale and each
// page carries the island.
func TestBuildHybridI18n(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, i18nFixture())
	cfg := config.Config{Output: "hybrid", I18n: enI18n}
	if err := Build(root, Options{Config: &cfg, Development: true}); err != nil {
		t.Fatalf("hybrid Build: %v", err)
	}
	home := readFile(t, filepath.Join(root, "dist", "index.html"))
	if !strings.Contains(home, "<h1>Welcome</h1>") || !strings.Contains(home, `data-puzzle-locale="en"`) {
		t.Errorf("hybrid home not prerendered with its island:\n%s", home)
	}
}

// templateVarsFixture is i18nFixture with a view that passes `t` its variables
// from the template, in the given argument spelling.
func templateVarsFixture(arg, countArg string) ssgFixtureFiles {
	files := i18nFixture()
	files["app/locales/en.json"] = `{ "home": { "title": "Welcome" }, "greeting": "Hello, {name}!", "items": { "one": "{count} item", "other": "{count} items" } }`
	files["app/views/Home.pzl"] = `<puzzle-view>
  <p class="greet">{ t('greeting', ` + arg + `) }</p>
  <p class="count">{ t('items', ` + countArg + `) }</p>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  data() { return { who: { name: 'Ada' }, counts: { count: 1 }, n: 3 }; }
}
</script>
`
	return files
}

// TestPrerenderTemplateTranslateVars: `t` with variables from a template renders
// through the real compiler and prerender — variables passed as a data field.
func TestPrerenderTemplateTranslateVars(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, templateVarsFixture("who", "counts"))
	cfg := config.Config{Output: "hybrid", I18n: enI18n}
	if err := Build(root, Options{Config: &cfg, Development: true}); err != nil {
		t.Fatalf("hybrid Build: %v", err)
	}
	home := readFile(t, filepath.Join(root, "dist", "index.html"))
	for _, want := range []string{`<p class="greet">Hello, Ada!</p>`, `<p class="count">1 item</p>`} {
		if !strings.Contains(home, want) {
			t.Errorf("prerendered home missing %s:\n%s", want, home)
		}
	}
}

// TestPrerenderTemplateTranslateObjectLiteral is the same through inline object
// literals (D173 V8): `t('greeting', { name: 'Ada' })`, and a plural chosen by
// `t('items', { count: n })` with `n` a data field.
func TestPrerenderTemplateTranslateObjectLiteral(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, templateVarsFixture("{ name: 'Ada' }", "{ count: n }"))
	cfg := config.Config{Output: "hybrid", I18n: enI18n}
	if err := Build(root, Options{Config: &cfg, Development: true}); err != nil {
		t.Fatalf("hybrid Build: %v", err)
	}
	home := readFile(t, filepath.Join(root, "dist", "index.html"))
	for _, want := range []string{`<p class="greet">Hello, Ada!</p>`, `<p class="count">3 items</p>`} {
		if !strings.Contains(home, want) {
			t.Errorf("prerendered home missing %s:\n%s", want, home)
		}
	}
}

// TestWatchBuilderLocaleEditReemitsAndPrunes: a string edit in dev re-emits the
// edited locale under a new hash, points app.js at it, and prunes the old file
// once the rebuild lands.
func TestWatchBuilderLocaleEditReemitsAndPrunes(t *testing.T) {
	root := writeSSGFixture(t, i18nFixture())
	b, err := NewWatchBuilder(root, WatchOptions{I18n: enI18n})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial rebuild: %v", err)
	}
	dist := filepath.Join(root, "dist")
	before := localeFiles(t, dist)
	if len(before) != 2 {
		t.Fatalf("dist/locales = %v", before)
	}

	es := filepath.Join(root, "app", "locales", "es.json")
	write(t, es, `{ "home": { "title": "¡Bienvenido!" } }`)
	if _, err := b.Rebuild([]string{es}); err != nil {
		t.Fatalf("locale rebuild: %v", err)
	}
	after := localeFiles(t, dist)
	if len(after) != 2 {
		t.Fatalf("the superseded es file was not pruned: %v", after)
	}
	appJS := readFile(t, filepath.Join(dist, "app.js"))
	for _, name := range after {
		if !strings.Contains(appJS, "locales/"+name) {
			t.Errorf("app.js does not name the current file %s", name)
		}
		if strings.HasPrefix(name, "es.") && strings.Contains(strings.Join(before, " "), name) {
			t.Errorf("es kept its old hash after an edit: %s", name)
		}
		if strings.HasPrefix(name, "en.") && !strings.Contains(strings.Join(before, " "), name) {
			t.Errorf("an untouched locale must keep its file: %s", name)
		}
	}

	// A broken edit fails the rebuild and leaves the served files alone.
	write(t, es, `{ "home": `)
	if _, err := b.Rebuild([]string{es}); err == nil {
		t.Fatal("a broken locale file must fail the rebuild")
	}
	if got := localeFiles(t, dist); strings.Join(got, ",") != strings.Join(after, ",") {
		t.Fatalf("a failed rebuild changed dist/locales: %v → %v", after, got)
	}
}

// TestStaticWatchLocaleEditIsRenderWide: under static dev, a locale edit is a
// full render and the served page shows the new string.
func TestStaticWatchLocaleEditIsRenderWide(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, i18nFixture())
	b, err := NewStaticWatchBuilder(root, StaticWatchOptions{Config: config.Config{Output: "static", I18n: enI18n}})
	if err != nil {
		t.Fatalf("NewStaticWatchBuilder: %v", err)
	}
	defer b.Dispose()
	if err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial rebuild: %v", err)
	}
	en := filepath.Join(root, "app", "locales", "en.json")
	write(t, en, `{ "home": { "title": "Welcome back" }, "items": { "one": "{count} item", "other": "{count} items" } }`)
	if err := b.Rebuild([]string{en}); err != nil {
		t.Fatalf("locale rebuild: %v", err)
	}
	if !b.lastPlan.full {
		t.Errorf("a locale edit must be a full render, got %+v", b.lastPlan)
	}
	home := readFile(t, filepath.Join(root, "dist", "index.html"))
	if !strings.Contains(home, "<h1>Welcome back</h1>") {
		t.Errorf("the edited string did not reach the page:\n%s", home)
	}
}

// TestWatchBuilderBrokenLocaleStaysFailedAcrossUnrelatedSaves: a broken locale
// file keeps failing the dev rebuild on a later save that does not touch
// app/locales/ — the builder remembers the failed load rather than succeeding on
// the last good tables and clearing the error overlay.
func TestWatchBuilderBrokenLocaleStaysFailedAcrossUnrelatedSaves(t *testing.T) {
	root := writeSSGFixture(t, i18nFixture())
	b, err := NewWatchBuilder(root, WatchOptions{I18n: enI18n})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial rebuild: %v", err)
	}
	es := filepath.Join(root, "app", "locales", "es.json")
	write(t, es, `{ "home": `)
	if _, err := b.Rebuild([]string{es}); err == nil {
		t.Fatal("a broken locale file must fail the rebuild")
	}
	home := filepath.Join(root, "app", "views", "Home.pzl")
	write(t, home, readFile(t, home)+"\n")
	if _, err := b.Rebuild([]string{home}); err == nil {
		t.Fatal("an unrelated save must not succeed while app/locales/es.json is still broken")
	}
	write(t, es, `{ "home": { "title": "Hola" } }`)
	if _, err := b.Rebuild([]string{home}); err != nil {
		t.Fatalf("a fixed locale file must let the next rebuild land: %v", err)
	}
	for _, name := range localeFiles(t, filepath.Join(root, "dist")) {
		if strings.HasPrefix(name, "es.") && !strings.Contains(readFile(t, filepath.Join(root, "dist", "locales", name)), "Hola") {
			t.Errorf("the fixed es table did not reach dist: %s", name)
		}
	}
}

// TestStaticWatchBrokenLocaleStaysFailedAcrossUnrelatedSaves is the same under
// static dev, where the accumulated pending set carries the locale edit.
func TestStaticWatchBrokenLocaleStaysFailedAcrossUnrelatedSaves(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, i18nFixture())
	b, err := NewStaticWatchBuilder(root, StaticWatchOptions{Config: config.Config{Output: "static", I18n: enI18n}})
	if err != nil {
		t.Fatalf("NewStaticWatchBuilder: %v", err)
	}
	defer b.Dispose()
	if err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial rebuild: %v", err)
	}
	es := filepath.Join(root, "app", "locales", "es.json")
	write(t, es, `{ "home": `)
	if err := b.Rebuild([]string{es}); err == nil {
		t.Fatal("a broken locale file must fail the rebuild")
	}
	home := filepath.Join(root, "app", "views", "Home.pzl")
	write(t, home, readFile(t, home)+"\n")
	if err := b.Rebuild([]string{home}); err == nil {
		t.Fatal("an unrelated save must not succeed while app/locales/es.json is still broken")
	}
	write(t, es, `{ "home": { "title": "Hola" } }`)
	if err := b.Rebuild([]string{home}); err != nil {
		t.Fatalf("a fixed locale file must let the next rebuild land: %v", err)
	}
}

// TestWatchBuilderPrunesSupersededUncommittedLocale: a locale load whose bundle
// never landed is replaced by the next load; its hashed file, already written to
// the live dist, must be pruned too once a bundle lands.
func TestWatchBuilderPrunesSupersededUncommittedLocale(t *testing.T) {
	root := writeSSGFixture(t, i18nFixture())
	b, err := NewWatchBuilder(root, WatchOptions{I18n: enI18n})
	if err != nil {
		t.Fatalf("NewWatchBuilder: %v", err)
	}
	defer b.Dispose()
	if _, err := b.Rebuild(nil); err != nil {
		t.Fatalf("initial rebuild: %v", err)
	}
	dist := filepath.Join(root, "dist")
	es := filepath.Join(root, "app", "locales", "es.json")
	home := filepath.Join(root, "app", "views", "Home.pzl")
	good := readFile(t, home)
	write(t, es, `{ "home": { "title": "B" } }`)
	write(t, home, "<puzzle-view><h1>{#if}</h1></puzzle-view>")
	if _, err := b.Rebuild([]string{es, home}); err == nil {
		t.Fatal("a broken view must fail the rebuild")
	}
	// The served bundle still names the first es file: it must survive.
	served := localeFiles(t, dist)
	if len(served) != 3 {
		t.Fatalf("dist/locales after the failed pass = %v, want the served pair plus es.B", served)
	}
	write(t, home, good)
	write(t, es, `{ "home": { "title": "C" } }`)
	if _, err := b.Rebuild([]string{es, home}); err != nil {
		t.Fatalf("recovering rebuild: %v", err)
	}
	after := localeFiles(t, dist)
	if len(after) != 2 {
		t.Fatalf("dist/locales = %v, want exactly one file per locale", after)
	}
	appJS := readFile(t, filepath.Join(dist, "app.js"))
	for _, name := range after {
		if !strings.Contains(appJS, "locales/"+name) {
			t.Errorf("dist/locales/%s is not named by app.js", name)
		}
	}
}

// TestNearestKeyCountsRunes: the did-you-mean distance is per character, so a
// non-ASCII key one accent away still gets its hint (a byte count would make
// it two edits per accent).
func TestNearestKeyCountsRunes(t *testing.T) {
	defaults := []string{"menú.título", "menu.total"}
	if got := nearestKey(defaults, "menu.titulo"); got != "menú.título" {
		t.Fatalf("nearestKey = %q", got)
	}
}
