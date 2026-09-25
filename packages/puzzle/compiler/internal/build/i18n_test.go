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

// i18nFixture is baseSSGFixture plus two locale files and a view that pipes a
// literal key through `t`.
func i18nFixture() ssgFixtureFiles {
	files := baseSSGFixture()
	files["app/locales/en.json"] = `{ "home": { "title": "Welcome" }, "items": { "one": "{count} item", "other": "{count} items" } }`
	files["app/locales/es.json"] = `{ "home": { "title": "Bienvenido" } }`
	files["app/views/Home.pzl"] = `<puzzle-view>
  <h1>{ 'home.title' | t }</h1>
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
	if err := ValidatePublic(root, false, false); err != nil {
		t.Fatalf("locales/ belongs to the app without i18n: %v", err)
	}
	err := ValidatePublic(root, false, true)
	if err == nil || !strings.Contains(err.Error(), "dist/locales") {
		t.Fatalf("expected a reserved-name error, got %v", err)
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
	if len(got) != 1 || !strings.Contains(got[0], "configures no i18n") {
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
func templateVarsFixture(arg string) ssgFixtureFiles {
	files := i18nFixture()
	files["app/locales/en.json"] = `{ "home": { "title": "Welcome" }, "greeting": "Hello, {name}!", "items": { "one": "{count} item", "other": "{count} items" } }`
	files["app/views/Home.pzl"] = `<puzzle-view>
  <p class="greet">{ 'greeting' | t(` + arg + `) }</p>
  <p class="count">{ 'items' | t(counts) }</p>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  data() { return { who: { name: 'Ada' }, counts: { count: 1 } }; }
}
</script>
`
	return files
}

// TestPrerenderTemplateTranslateVars: `t` with variables from a template renders
// through the real compiler and prerender — variables passed as a data field.
func TestPrerenderTemplateTranslateVars(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, templateVarsFixture("who"))
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

// TestPrerenderTemplateTranslateObjectLiteral is the same through an inline
// object literal, `t({ name: 'Ada' })`. TODO(V8): the object-literal argument
// needs D173 V8's codegen fix (feat/core-expressions) — today codegen scopes the
// KEY (`{ __d.name: … }`). Enable once that branch merges.
func TestPrerenderTemplateTranslateObjectLiteral(t *testing.T) {
	t.Skip("TODO(V8): enable once feat/core-expressions (D173 V8 object-literal arguments) merges")
	requireStaticRuntime(t)
	root := writeSSGFixture(t, templateVarsFixture("{ name: 'Ada' }"))
	cfg := config.Config{Output: "hybrid", I18n: enI18n}
	if err := Build(root, Options{Config: &cfg, Development: true}); err != nil {
		t.Fatalf("hybrid Build: %v", err)
	}
	home := readFile(t, filepath.Join(root, "dist", "index.html"))
	if !strings.Contains(home, `<p class="greet">Hello, Ada!</p>`) {
		t.Errorf("prerendered home missing the filled greeting:\n%s", home)
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
