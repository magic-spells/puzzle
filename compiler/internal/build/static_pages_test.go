package build

import (
	"encoding/json"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/evanw/esbuild/pkg/api"
	"github.com/magic-spells/puzzle/compiler/internal/config"
)

// TestResolveOutputMode covers the flag↔config reconciliation (CONTRACT 1): a
// flag and a DIFFERENT config output value is an error; otherwise the non-empty
// side wins (agreement is fine), and neither set is the default SPA build.
func TestResolveOutputMode(t *testing.T) {
	tests := []struct {
		name    string
		flag    string
		cfgOut  string
		want    string
		wantErr bool
	}{
		{"neither set → SPA", "", "", "", false},
		{"flag static only", "static", "", "static", false},
		{"flag hybrid only", "hybrid", "", "hybrid", false},
		{"config static only", "", "static", "static", false},
		{"config hybrid only", "", "hybrid", "hybrid", false},
		{"flag agrees with config", "static", "static", "static", false},
		{"hybrid agrees with config", "hybrid", "hybrid", "hybrid", false},
		{"static flag vs hybrid config", "static", "hybrid", "", true},
		{"hybrid flag vs static config", "hybrid", "static", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveOutputMode(tt.flag, config.Config{Output: tt.cfgOut})
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected a conflict error for flag=%q config=%q", tt.flag, tt.cfgOut)
				}
				// The message must name both modes so the fix is discoverable.
				if !strings.Contains(err.Error(), tt.flag) || !strings.Contains(err.Error(), tt.cfgOut) {
					t.Errorf("conflict error should name both flag and config value, got: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("resolveOutputMode(%q, %q) = %q, want %q", tt.flag, tt.cfgOut, got, tt.want)
			}
		})
	}
}

// TestSlugFromEntry pins the "_puzzle/<slug>.js" → "<slug>" extraction and its
// rejection of malformed shapes.
func TestSlugFromEntry(t *testing.T) {
	ok := map[string]string{
		"_puzzle/index.js":            "index",
		"_puzzle/404.js":              "404",
		"_puzzle/guide--templates.js": "guide--templates",
		"/_puzzle/about.js":           "about",
	}
	for in, want := range ok {
		got, err := slugFromEntry(in)
		if err != nil {
			t.Errorf("slugFromEntry(%q) errored: %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("slugFromEntry(%q) = %q, want %q", in, got, want)
		}
	}
	for _, bad := range []string{"_puzzle/.js", "_puzzle/a/b.js", ""} {
		if _, err := slugFromEntry(bad); err == nil {
			t.Errorf("slugFromEntry(%q) should have errored", bad)
		}
	}
}

// cannedSummary is a hand-built static summary standing in for the JS side's
// output, so entry-file generation is tested without running node. Its adapter
// is the BARE capability with no conventional module on disk — the leanest of
// the three tiers; the tier tests below vary those two fields.
func cannedSummary() staticSummary {
	layout := "app/layouts/Default.pzl"
	return staticSummary{
		Mode:                 "static",
		Target:               "app",
		APIURL:               json.RawMessage(`"https://api.example.com"`),
		RouterBase:           json.RawMessage(`"/docs"`),
		HasModels:            true,
		HasFormatters:        true,
		HasAdapter:           true,
		AdapterConfigured:    false,
		AdapterModuleMatches: nil,
		Written: []staticPage{
			{
				Path:      "/",
				Prerender: true,
				Entry:     "_puzzle/index.js",
				Modules:   staticModules{Views: []string{"app/views/Home.pzl"}, Layout: &layout},
				Route:     json.RawMessage(`{"path":"/","params":{},"chain":[{"path":"/","name":"home"}]}`),
			},
			{
				Path:      "/guide/templates",
				Prerender: true,
				Entry:     "_puzzle/guide--templates.js",
				Modules:   staticModules{Views: []string{"app/views/Guide.pzl", "app/views/Templates.pzl"}, Layout: nil},
				Route:     json.RawMessage(`{"path":"/guide/templates","params":{},"chain":[{"path":"/guide"},{"path":"templates"}]}`),
			},
		},
	}
}

// TestStaticEntrySourceFull generates the entry for a page that has a layout and
// whose app ships both a models registry and a formatters module.
func TestStaticEntrySourceFull(t *testing.T) {
	root := "/abs/app-root"
	s := cannedSummary()
	src, err := staticEntrySource(
		root,
		s.Written[0],
		s,
		"app/models/index.ts",
		"app/formatters.ts",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	wants := []string{
		`import { mountStatic } from '@magic-spells/puzzle/static';`,
		`import { adapter } from '@magic-spells/puzzle/adapter';`,
		`import V0 from "/abs/app-root/app/views/Home.pzl";`,
		`import L0 from "/abs/app-root/app/layouts/Default.pzl";`,
		`import models from "/abs/app-root/app/models/index.ts";`,
		`import formatters from "/abs/app-root/app/formatters.ts";`,
		`target: "#app",`,
		`views: [V0],`,
		`layout: L0,`,
		`route: {"path":"/","params":{},"chain":[{"path":"/","name":"home"}]},`,
		`models,`,
		`formatters,`,
		`adapter,`,
		`apiURL: "https://api.example.com",`,
		`routerBase: "/docs",`,
		`}).catch((err) => {`,
	}
	for _, w := range wants {
		if !strings.Contains(src, w) {
			t.Errorf("generated entry missing %q\n---\n%s", w, src)
		}
	}
	// Storage is never emitted: a live Storage serializes to a dead `{}`, so static
	// output drops it (the JS build warns instead). Guard it even in the full case.
	if strings.Contains(src, "storage:") {
		t.Errorf("generated entry must not emit storage\n---\n%s", src)
	}
	// routerMode is never emitted either (D159): static pages have no router, and a
	// mode is an imported object that would serialize to a dead `{}` here.
	if strings.Contains(src, "routerMode:") {
		t.Errorf("generated entry must not emit routerMode\n---\n%s", src)
	}
}

// TestStaticEntrySourceAdapterTiers pins the three ways a page entry can reach
// the SAME capability value the prerender installed. The failure this guards is
// silent: an entry that binds a different adapter than the render used produces
// pages that either throw at mount or quietly serve different data than the
// markup shipped with them.
func TestStaticEntrySourceAdapterTiers(t *testing.T) {
	yes, no := true, false
	bare := `import { adapter } from '@magic-spells/puzzle/adapter';`
	conventional := `import adapter from "/abs/app-root/app/adapter.js";`
	capture := `import __pzlApp from "/abs/app-root/app/app.js";`

	tests := []struct {
		name       string
		configured bool
		matches    *bool
		module     string
		want       string
		absent     []string
		wantNote   bool
	}{
		{
			name:   "bare capability, no module",
			want:   bare,
			absent: []string{conventional, capture},
		},
		{
			// The config passed the bare export, so THAT is what the render installed
			// — a conventional module holding something else must not win over it.
			name:   "bare capability wins over a mismatched module",
			module: "app/adapter.js",
			want:   bare,
			absent: []string{conventional, capture},
		},
		{
			name:       "configured capability that is the conventional module",
			configured: true,
			matches:    &yes,
			module:     "app/adapter.js",
			want:       conventional,
			absent:     []string{bare, capture},
		},
		{
			// Inline adapter.defaults(...) in app.js: the value exists nowhere else,
			// so the entry reads it off the app config.
			name:       "configured capability with no module",
			configured: true,
			want:       capture,
			absent:     []string{bare, conventional},
			wantNote:   true,
		},
		{
			// A module exists but holds a DIFFERENT value — trusting the convention
			// here is what made pages silently serve another adapter's data.
			name:       "configured capability a module does not match",
			configured: true,
			matches:    &no,
			module:     "app/adapter.js",
			want:       capture,
			absent:     []string{bare, conventional},
			wantNote:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := cannedSummary()
			s.AdapterConfigured = tt.configured
			s.AdapterModuleMatches = tt.matches
			src, err := staticEntrySource("/abs/app-root", s.Written[0], s, "", "", tt.module)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(src, tt.want) {
				t.Errorf("generated entry missing %q\n---\n%s", tt.want, src)
			}
			for _, absent := range tt.absent {
				if strings.Contains(src, absent) {
					t.Errorf("generated entry should not contain %q\n---\n%s", absent, src)
				}
			}
			// Every tier binds `adapter` and passes it — only the binding differs.
			if !strings.Contains(src, "\n  adapter,\n") {
				t.Errorf("generated entry does not pass the adapter to mountStatic\n---\n%s", src)
			}
			if tt.want == capture && !strings.Contains(src, "const adapter = (__pzlApp?.config ?? __pzlApp).adapter;") {
				t.Errorf("capture entry does not read the adapter off the app config\n---\n%s", src)
			}
			if got := staticCaptured(s, tt.module); got != tt.wantNote {
				t.Errorf("staticCaptured = %v, want %v (the page-weight note)", got, tt.wantNote)
			}
		})
	}
}

// An app with no adapter at all is never in the capture tier, whatever files
// happen to sit in app/.
func TestStaticCapturedIgnoresAdapterlessApps(t *testing.T) {
	s := cannedSummary()
	s.HasAdapter = false
	s.AdapterConfigured = true
	if staticCaptured(s, "") {
		t.Error("an app that passed no adapter must not take the capture tier")
	}
}

// The conventional module is imported by the PRERENDER entry too — that import
// is the only place the identity answer can come from. A missing module leaves
// the generated source byte-identical to the pre-D157 one.
func TestStaticPrerenderStdinImportsTheAdapterModule(t *testing.T) {
	root := filepath.FromSlash("/abs/app-root")

	without, err := staticPrerenderStdin(root, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(without, "adapterModule") {
		t.Errorf("no app/adapter module on disk, but the prerender entry names one:\n%s", without)
	}

	with, err := staticPrerenderStdin(root, "app/adapter.js")
	if err != nil {
		t.Fatal(err)
	}
	// A NAMESPACE import: this file may exist for unrelated reasons and export no
	// default, which a default import would turn into a hard bundle failure.
	if !strings.Contains(with, `import * as __pzlAdapterModule from "/abs/app-root/app/adapter.js";`) {
		t.Errorf("prerender entry does not namespace-import the app adapter module:\n%s", with)
	}
	if !strings.Contains(with, "adapterModule: __pzlAdapterModule.default") {
		t.Errorf("prerender entry does not pass the module to prerenderToDir:\n%s", with)
	}
}

// TestStaticEntrySourceMinimal generates the entry for a layout-less, multi-view
// page in an app with NO models and NO formatters files: those imports and the
// call shorthands must be omitted, layout is null, apiURL is null.
func TestStaticEntrySourceMinimal(t *testing.T) {
	root := "/abs/app-root"
	s := cannedSummary()
	page := s.Written[1]
	s.APIURL = nil
	s.RouterBase = nil
	s.HasAdapter = false
	src, err := staticEntrySource(root, page, s, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	wants := []string{
		`import V0 from "/abs/app-root/app/views/Guide.pzl";`,
		`import V1 from "/abs/app-root/app/views/Templates.pzl";`,
		`views: [V0, V1],`,
		`layout: null,`,
		`apiURL: null,`,
	}
	for _, w := range wants {
		if !strings.Contains(src, w) {
			t.Errorf("generated entry missing %q\n---\n%s", w, src)
		}
	}
	// No layout import, and no models/formatters imports or shorthands.
	for _, absent := range []string{
		"import L0",
		"import models",
		"import formatters",
		"import { adapter }",
		"\n  models,",
		"\n  formatters,",
		"\n  adapter,",
		"\n  storage:",
		"\n  routerMode:",
		"\n  routerBase:",
	} {
		if strings.Contains(src, absent) {
			t.Errorf("generated minimal entry should not contain %q\n---\n%s", absent, src)
		}
	}
}

// mountStatic is async and nothing awaits it, so the generated entry must
// observe its rejection. Without the .catch the prerendered markup stays on
// screen (replaceChildren never ran) looking correct while nothing is
// interactive, and the only signal is an uncaught rejection.
func TestStaticEntrySourceObservesMountRejection(t *testing.T) {
	s := cannedSummary()
	for _, page := range s.Written {
		src, err := staticEntrySource("/abs/app-root", page, s, "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(src, "}).catch((err) => {") {
			t.Errorf("entry for %s does not observe the mountStatic rejection\n---\n%s", page.Path, src)
		}
		// A greppable, prefixed message — the one signal a broken static page gives.
		if !strings.Contains(src, "console.error('[puzzle] static page mount failed:', err);") {
			t.Errorf("entry for %s missing the [puzzle] mount-failure log\n---\n%s", page.Path, src)
		}
		// Production strips console.*, which would leave the handler EMPTY and
		// swallow the rejection; the async rethrow survives the drop and reaches
		// window.onerror.
		if !strings.Contains(src, "setTimeout(() => { throw err; });") {
			t.Errorf("entry for %s does not rethrow past console stripping\n---\n%s", page.Path, src)
		}
	}
}

// TestStaticEntrySourceMountFailureSurvivesConsoleStripping is the same claim at
// the bundler level: run the generated tail through the production policy
// bundleStaticPages applies (Drop: console + minify) and prove a signal remains.
// A bare console.error handler compiles to `.catch(() => {})` there.
func TestStaticEntrySourceMountFailureSurvivesConsoleStripping(t *testing.T) {
	s := cannedSummary()
	src, err := staticEntrySource("/abs/app-root", s.Written[0], s, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	// Only the .catch tail matters here; the imports resolve nowhere, so transform
	// (not bundle) the source.
	result := api.Transform(src, api.TransformOptions{
		Loader:            api.LoaderJS,
		Format:            api.FormatESModule,
		Target:            api.ES2022,
		Drop:              api.DropConsole,
		MinifyWhitespace:  true,
		MinifyIdentifiers: true,
		MinifySyntax:      true,
	})
	if len(result.Errors) > 0 {
		t.Fatalf("transforming the generated entry failed: %v", result.Errors)
	}
	out := string(result.Code)
	if strings.Contains(out, "console") {
		t.Fatalf("console.* should have been dropped:\n%s", out)
	}
	if !strings.Contains(out, "throw") {
		t.Errorf("stripped entry swallows the mount rejection — no throw survives:\n%s", out)
	}
}

// plugin.relName falls back to the ABSOLUTE path when a .pzl resolves outside
// the app root (symlinked node_modules, monorepo layouts), and that value
// arrives here as the module stamp. Joining it onto absRoot would emit an import
// of <absRoot>/Users/… and fail the per-page bundle with "Could not resolve".
func TestAbsModuleImportKeepsAbsolutePaths(t *testing.T) {
	root := filepath.FromSlash("/abs/app-root")
	abs := filepath.ToSlash(filepath.Join(string(filepath.Separator), "elsewhere", "pkg", "Docs.pzl"))
	if got := absModuleImport(root, abs); got != abs {
		t.Errorf("absModuleImport(%q, %q) = %q, want the path unchanged", root, abs, got)
	}
	// Relative stamps still join onto the app root.
	if got, want := absModuleImport(root, "app/views/Home.pzl"), "/abs/app-root/app/views/Home.pzl"; got != want {
		t.Errorf("absModuleImport(%q, %q) = %q, want %q", root, "app/views/Home.pzl", got, want)
	}
}

func TestFindStaticModuleSupportsTypeScriptAndPrefersJavaScript(t *testing.T) {
	root := t.TempDir()
	modelsDir := filepath.Join(root, "app", "models")
	if err := os.MkdirAll(modelsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	tsPath := filepath.Join(modelsDir, "index.ts")
	if err := os.WriteFile(tsPath, []byte("export default {}"), 0o644); err != nil {
		t.Fatal(err)
	}

	candidates := []string{"app/models/index.js", "app/models/index.ts"}
	if got := findStaticModule(root, candidates...); got != "app/models/index.ts" {
		t.Fatalf("TypeScript-only module = %q, want app/models/index.ts", got)
	}

	jsPath := filepath.Join(modelsDir, "index.js")
	if err := os.WriteFile(jsPath, []byte("export default {}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := findStaticModule(root, candidates...); got != "app/models/index.js" {
		t.Fatalf("JS+TS module = %q, want JavaScript precedence", got)
	}
}

// TestBuildStaticEmitsPages is the static-mode integration run: an
// Output:"static" build writes per-route content-complete HTML with the
// data-puzzle-static marker, NO /app.js script, an inline data island, and a
// /_puzzle/<slug>.js module script; the per-page bundles land in dist/_puzzle/;
// dist/app.js is gone; styles.css remains. Skipped until the JS static kernel
// lands. (This is the one test the design doc flags as depending on the JS half.)
func TestBuildStaticEmitsPages(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, baseSSGFixture())

	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	buildErr := Build(root, Options{Development: true, Output: "static"})
	w.Close()
	os.Stdout = oldStdout
	captured, _ := io.ReadAll(r)
	if buildErr != nil {
		t.Fatalf("static Build failed: %v", buildErr)
	}
	if !strings.Contains(string(captured), "puzzle build · static") {
		t.Errorf("static build summary header should read 'puzzle build · static', got:\n%s", captured)
	}
	if !strings.Contains(string(captured), "page bundle") {
		t.Errorf("static build summary should report a page-bundle count, got:\n%s", captured)
	}

	dist := filepath.Join(root, "dist")
	home := readFile(t, filepath.Join(dist, "index.html"))
	if strings.Contains(home, `src="/app.js"`) {
		t.Errorf("static page must not load /app.js:\n%s", home)
	}
	if !strings.Contains(home, "data-puzzle-static") {
		t.Errorf("static page missing the data-puzzle-static marker:\n%s", home)
	}
	if !strings.Contains(home, "data-puzzle-static-data") {
		t.Errorf("static page missing the inline data island:\n%s", home)
	}
	if !strings.Contains(home, "/_puzzle/index.js") {
		t.Errorf("static page missing its per-page module script /_puzzle/index.js:\n%s", home)
	}

	// The per-page bundle exists in dist/_puzzle/.
	if _, err := os.Stat(filepath.Join(dist, staticPagesDir, "index.js")); err != nil {
		t.Errorf("expected dist/%s/index.js per-page bundle: %v", staticPagesDir, err)
	}
	// No shared SPA bundle ships in static mode; styles.css still does.
	if _, err := os.Stat(filepath.Join(dist, "app.js")); !os.IsNotExist(err) {
		t.Errorf("dist/app.js must be absent in static mode (err=%v)", err)
	}
	if _, err := os.Stat(filepath.Join(dist, "styles.css")); err != nil {
		t.Errorf("expected dist/styles.css in static mode: %v", err)
	}
	// The prerender scaffolding never ships.
	if _, err := os.Stat(filepath.Join(dist, prerenderDir)); !os.IsNotExist(err) {
		t.Errorf("%s must be deleted before the swap; it survived in dist/ (err=%v)", prerenderDir, err)
	}
}

// inlineAdapterFixture is a static app whose adapter is configured IN app.js —
// `adapter.defaults({ loadAll })` passed straight into the config, the shape a
// small app writes before it ever grows an app/adapter.js. Its one model is
// endpoint-less on purpose: only that app-level default can serve `loadAll`, so
// a page that installs any other capability fails loudly instead of quietly
// agreeing. adapterModule, when non-empty, adds an app/adapter.js the config
// deliberately ignores.
func inlineAdapterFixture(adapterModule string) ssgFixtureFiles {
	files := baseSSGFixture()
	files["app/models/index.js"] = `import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export class Item extends PuzzleModel {
  static schema = { id: Puzzle.string().primary(), text: Puzzle.string() };
  static adapter = {};
}

export default { item: Item };
`
	files["app/app.js"] = `import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  adapter: adapter.defaults({
    loadAll: async () => [{ id: '1', text: 'INLINE_ADAPTER_MARKER' }],
  }),
  beforeMount({ store }) { return store.loadAll('item'); },
});
app.mount();
export default app;
`
	files["app/views/Home.pzl"] = `<puzzle-view>
  <ul>{#for item in items}<li>{ item.text }</li>{/for}</ul>
</puzzle-view>
<script>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Home extends PuzzleView {
  data() { return { items: this.ctx.store.findMany('item') }; }
}
</script>
`
	if adapterModule != "" {
		files[adapterModule] = `import { adapter } from '@magic-spells/puzzle/adapter';

export default adapter.defaults({
  loadAll: async () => [{ id: '1', text: 'CONVENTIONAL_MODULE_MARKER' }],
});
`
	}
	return files
}

// staticPageBundleSources concatenates every .js under dist/_puzzle (entries and
// shared chunks) — "the code the pages actually run".
func staticPageBundleSources(t *testing.T, dist string) string {
	t.Helper()
	var b strings.Builder
	err := filepath.WalkDir(filepath.Join(dist, staticPagesDir), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".js") {
			return err
		}
		data, readErr := os.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		b.Write(data)
		return nil
	})
	if err != nil {
		t.Fatalf("reading the page bundles under %s: %v", dist, err)
	}
	return b.String()
}

// TestBuildStaticShipsTheConfiguredAdapter is the end-to-end claim behind the
// three-tier entry generation: an app that configures its adapter inline builds,
// and the pages ship THAT adapter. The regression it guards produced a green
// build whose every page threw `no adapter loadAll() declared` in the browser,
// because the generated entry re-imported the bare capability and the configured
// verbs never reached the client.
func TestBuildStaticShipsTheConfiguredAdapter(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, inlineAdapterFixture(""))

	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	buildErr := Build(root, Options{Development: true, Output: "static"})
	w.Close()
	os.Stdout = oldStdout
	captured, _ := io.ReadAll(r)
	if buildErr != nil {
		t.Fatalf("a static build with an inline adapter must succeed, got: %v", buildErr)
	}
	// The build says what the shape costs, and does not fail over it.
	if !strings.Contains(string(captured), "each static page imports app/app.js") {
		t.Errorf("static build did not note the capture tier's page weight, got:\n%s", captured)
	}

	dist := filepath.Join(root, "dist")
	// The prerender ran the configured loadAll: its records are in the markup.
	if home := readFile(t, filepath.Join(dist, "index.html")); !strings.Contains(home, "INLINE_ADAPTER_MARKER") {
		t.Errorf("prerendered page missing the configured adapter's data:\n%s", home)
	}
	// And the same verb ships, so the client re-render resolves identically.
	bundles := staticPageBundleSources(t, dist)
	if !strings.Contains(bundles, "INLINE_ADAPTER_MARKER") {
		t.Error("the page bundles do not carry the configured adapter's loadAll — the client would install the bare capability and throw")
	}
}

// The conventional module is a CONVENTION, not a claim: when the config passed
// something else, the file is bypassed rather than trusted. Trusting it shipped
// pages that silently served different data than the markup beside them.
func TestBuildStaticBypassesAMismatchedAdapterModule(t *testing.T) {
	requireStaticRuntime(t)
	root := writeSSGFixture(t, inlineAdapterFixture("app/adapter.js"))

	if err := Build(root, Options{Development: true, Output: "static"}); err != nil {
		t.Fatalf("static Build failed: %v", err)
	}

	bundles := staticPageBundleSources(t, filepath.Join(root, "dist"))
	if !strings.Contains(bundles, "INLINE_ADAPTER_MARKER") {
		t.Error("the page bundles do not carry the adapter the config actually passed")
	}
	if strings.Contains(bundles, "CONVENTIONAL_MODULE_MARKER") {
		t.Error("the page bundles installed app/adapter.js over the capability the config passed")
	}
}

// TestStaticPagesSourcemapPolicy pins the per-page bundle pass to the same
// source-map policy as the main app.js pass: development keeps linked maps,
// production emits them only when build.sourceMap opts in. The pass used to emit
// maps unconditionally and a post-pass deleted them again, so a regression here
// means shipping (or throwing away) bytes the config never asked for.
func TestStaticPagesSourcemapPolicy(t *testing.T) {
	var on config.Config
	on.Build.SourceMap = true

	tests := []struct {
		name string
		cfg  config.Config
		dev  bool
		want api.SourceMap
	}{
		{"development keeps linked maps", config.Config{}, true, api.SourceMapLinked},
		{"production without build.sourceMap emits none", config.Config{}, false, api.SourceMapNone},
		{"production with build.sourceMap keeps linked maps", on, false, api.SourceMapLinked},
		{"development with build.sourceMap keeps linked maps", on, true, api.SourceMapLinked},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := staticPagesSourcemap(tt.cfg, tt.dev); got != tt.want {
				t.Fatalf("staticPagesSourcemap = %v, want %v", got, tt.want)
			}
		})
	}
}
