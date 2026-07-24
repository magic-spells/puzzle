package build

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

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
// output, so entry-file generation is tested without running node.
func cannedSummary() staticSummary {
	layout := "app/layouts/Default.pzl"
	return staticSummary{
		Mode:          "static",
		Target:        "app",
		APIURL:        json.RawMessage(`"https://api.example.com"`),
		RouterBase:    json.RawMessage(`"/docs"`),
		RouterMode:    json.RawMessage(`"hash"`),
		HasModels:     true,
		HasFormatters: true,
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
	)
	if err != nil {
		t.Fatal(err)
	}
	wants := []string{
		`import { mountStatic } from '@magic-spells/puzzle/static';`,
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
		`apiURL: "https://api.example.com",`,
		`routerMode: "hash",`,
		`routerBase: "/docs",`,
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
}

// TestStaticEntrySourceMinimal generates the entry for a layout-less, multi-view
// page in an app with NO models and NO formatters files: those imports and the
// call shorthands must be omitted, layout is null, apiURL is null.
func TestStaticEntrySourceMinimal(t *testing.T) {
	root := "/abs/app-root"
	s := cannedSummary()
	page := s.Written[1]
	s.APIURL = nil
	s.RouterMode = nil
	s.RouterBase = nil
	src, err := staticEntrySource(root, page, s, "", "")
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
		"\n  models,",
		"\n  formatters,",
		"\n  storage:",
		"\n  routerMode:",
		"\n  routerBase:",
	} {
		if strings.Contains(src, absent) {
			t.Errorf("generated minimal entry should not contain %q\n---\n%s", absent, src)
		}
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
