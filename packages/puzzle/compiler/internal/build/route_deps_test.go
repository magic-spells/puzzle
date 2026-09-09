package build

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// metafileJSON assembles the fragment of an esbuild metafile the graph reads:
// inputs with their import edges, keyed relative to the pass's working dir.
func metafileJSON(t *testing.T, inputs map[string][]string) string {
	t.Helper()
	type imp struct {
		Path string `json:"path"`
	}
	type input struct {
		Imports []imp `json:"imports"`
	}
	shaped := map[string]input{}
	for key, deps := range inputs {
		in := input{Imports: []imp{}}
		for _, d := range deps {
			in.Imports = append(in.Imports, imp{Path: d})
		}
		shaped[key] = in
	}
	out, err := json.Marshal(map[string]any{"inputs": shaped})
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// testGraph builds a routeGraph over a throwaway tree with two routes: /a
// (entry a.js → View A → shared) and /b (entry b.js → View B → shared), plus a
// render-wide app.js → routes.js chain that reaches both views.
func testGraph(t *testing.T) (root string, g *routeGraph) {
	t.Helper()
	root = t.TempDir()
	base := filepath.Join(root, "warm")
	files := []string{
		"warm/a.js", "warm/b.js",
		"app/views/A.pzl", "app/views/B.pzl", "app/components/Shared.pzl",
		"app/app.js", "app/routes.js", "app/public/index.html", "app/public/logo.png",
		// public/ is inside the module resolve tree: data.js is imported by one
		// page's view, wide.js only by the app entry.
		"app/public/data.js", "app/public/wide.js",
		// The overlap: seed.js is imported by app.js (it seeds the store from
		// beforeMount, so it shapes every page) AND directly by one view.
		// helper.js is the ordinary case it must not be confused with — a private
		// helper only one view imports.
		"app/lib/seed.js", "app/lib/helper.js",
		"app/styles/extra.css", "app/assets/icon.svg",
	}
	for _, f := range files {
		p := filepath.Join(root, filepath.FromSlash(f))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	pages := metafileJSON(t, map[string][]string{
		"a.js":                         {"../app/views/A.pzl"},
		"b.js":                         {"../app/views/B.pzl"},
		"../app/views/A.pzl":           {"../app/components/Shared.pzl", "../app/public/data.js", "../app/lib/seed.js", "../app/lib/helper.js"},
		"../app/views/B.pzl":           {"../app/components/Shared.pzl"},
		"../app/components/Shared.pzl": {},
		"../app/public/data.js":        {},
		"../app/lib/seed.js":           {},
		"../app/lib/helper.js":         {},
	})
	pre := metafileJSON(t, map[string][]string{
		// The generated stdin entry: a module key that matches no file on disk,
		// which is why the walk finds its roots by in-degree rather than by name.
		"puzzle-prerender-entry.js": {"app/app.js"},
		"app/app.js":                {"app/routes.js", "app/public/wide.js", "app/lib/seed.js"},
		"app/routes.js":             {"app/views/A.pzl", "app/views/B.pzl"},
		"app/views/A.pzl":           {"app/components/Shared.pzl", "app/public/data.js", "app/lib/seed.js", "app/lib/helper.js"},
		"app/views/B.pzl":           {"app/components/Shared.pzl"},
		"app/components/Shared.pzl": {},
		"app/public/data.js":        {},
		"app/public/wide.js":        {},
		"app/lib/seed.js":           {},
		"app/lib/helper.js":         {},
	})

	// The chain roots the prerender summary reports: one view per route (this
	// fixture has no layout).
	chainRoots := map[string]bool{
		resolvePath(filepath.Join(root, "app", "views", "A.pzl")): true,
		resolvePath(filepath.Join(root, "app", "views", "B.pzl")): true,
	}
	g, err := buildRouteGraph(pages, base, pre, root, map[string]string{
		filepath.Join(base, "a.js"): "/a",
		filepath.Join(base, "b.js"): "/b",
	}, chainRoots)
	if err != nil {
		t.Fatalf("buildRouteGraph: %v", err)
	}
	return root, g
}

func TestRouteGraphClassify(t *testing.T) {
	root, g := testGraph(t)
	rel := func(p string) string { return filepath.Join(root, filepath.FromSlash(p)) }

	// The {#svg} edge esbuild never reports: the icon is inlined by A.pzl.
	consumers := func(paths []string) []string {
		for _, p := range paths {
			if filepath.Base(p) == "icon.svg" {
				return []string{rel("app/views/A.pzl")}
			}
		}
		return nil
	}

	cases := []struct {
		name    string
		changed []string
		full    bool
		routes  string
	}{
		{"a leaf view is its own route", []string{rel("app/views/A.pzl")}, false, "/a"},
		{"a shared component is every route that imports it", []string{rel("app/components/Shared.pzl")}, false, "/a,/b"},
		{"the route table is render-wide", []string{rel("app/routes.js")}, true, ""},
		{"the app entry is render-wide", []string{rel("app/app.js")}, true, ""},
		{"the shell reaches every page", []string{rel("app/public/index.html")}, true, ""},
		{"another public asset reaches none", []string{rel("app/public/logo.png")}, false, ""},
		{"a public module a page imports is that page", []string{rel("app/public/data.js")}, false, "/a"},
		{"a public module only the app entry imports is render-wide", []string{rel("app/public/wide.js")}, true, ""},
		// The regression this file exists for. seed.js is page-reachable AND
		// render-wide: app.js runs it for every page, and view A also imports it
		// directly. Deciding render-wide membership by subtracting the page graph
		// let page attribution swallow it, so editing the store seed re-rendered
		// only /a and left /b serving stale HTML and a stale data island — with no
		// periodic full render to ever wash it out.
		{"a module both the app entry and a view import is render-wide", []string{rel("app/lib/seed.js")}, true, ""},
		// …and the fast path it must not cost: a helper only one view imports sits
		// below the chain root, so the walk never reaches it and it stays that
		// route's business.
		{"a view-private helper is still just its route", []string{rel("app/lib/helper.js")}, false, "/a"},
		{"the most conservative member wins over a private helper", []string{rel("app/lib/helper.js"), rel("app/lib/seed.js")}, true, ""},
		{"an imported public module unions with a view", []string{rel("app/public/data.js"), rel("app/views/B.pzl")}, false, "/a,/b"},
		{"a standalone stylesheet reaches none", []string{rel("app/styles/extra.css")}, false, ""},
		{"an inlined asset reaches its consumers", []string{rel("app/assets/icon.svg")}, false, "/a"},
		{"a file nothing knows about is a full render", []string{rel("app/mystery.js")}, true, ""},
		{"an empty batch is a full render", nil, true, ""},
		{"the most conservative member wins", []string{rel("app/views/A.pzl"), rel("app/routes.js")}, true, ""},
		{"two partials union", []string{rel("app/views/A.pzl"), rel("app/views/B.pzl")}, false, "/a,/b"},
	}
	for _, tt := range cases {
		got := g.classify(root, tt.changed, consumers)
		if got.full != tt.full {
			t.Errorf("%s: full=%v (%s), want %v", tt.name, got.full, got.reason, tt.full)
			continue
		}
		if !tt.full && strings.Join(got.routes, ",") != tt.routes {
			t.Errorf("%s: routes %v, want %q", tt.name, got.routes, tt.routes)
		}
	}

	// A deleted source file can remove a module the graph still believes in.
	if err := os.Remove(rel("app/views/A.pzl")); err != nil {
		t.Fatal(err)
	}
	if plan := g.classify(root, []string{rel("app/views/A.pzl")}, consumers); !plan.full {
		t.Errorf("a deleted .pzl must force a full render, got %v", plan.routes)
	}

	// The same rule under public/: a path the graph believes is a module cannot
	// take the copy-only path just because it lives beside the assets. Its
	// disappearance removes a module the bundle still imports.
	if err := os.Remove(rel("app/public/data.js")); err != nil {
		t.Fatal(err)
	}
	if plan := g.classify(root, []string{rel("app/public/data.js")}, consumers); !plan.full {
		t.Errorf("a deleted imported public module must force a full render, got %v", plan.routes)
	}
	// …while a deleted UNIMPORTED public asset stays the zero-render copy that no
	// longer happens.
	if err := os.Remove(rel("app/public/logo.png")); err != nil {
		t.Fatal(err)
	}
	if plan := g.classify(root, []string{rel("app/public/logo.png")}, consumers); plan.full || len(plan.routes) != 0 {
		t.Errorf("a deleted unimported public asset must render nothing: full=%v routes=%v", plan.full, plan.routes)
	}
}

// A root-level public/ is a documented layout (publicDir resolves it and
// `puzzle dev` watches it), so the shell special-case and the public-asset
// skip have to find it there too — hardcoding app/public/ dropped every
// root-public project onto the "an unknown file changed" full-render path.
func TestRouteGraphClassifyRootPublic(t *testing.T) {
	root, g := testGraph(t)
	rel := func(p string) string { return filepath.Join(root, filepath.FromSlash(p)) }

	// Move the public tree to <root>/public so publicDir resolves the fallback.
	if err := os.RemoveAll(rel("app/public")); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"public/index.html", "public/logo.png"} {
		p := rel(f)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	if plan := g.classify(root, []string{rel("public/index.html")}, nil); !plan.full {
		t.Errorf("a root-level shell must force a full render, got routes %v", plan.routes)
	}
	plan := g.classify(root, []string{rel("public/logo.png")}, nil)
	if plan.full || len(plan.routes) != 0 {
		t.Errorf("a root-level public asset must render nothing: full=%v (%s) routes=%v",
			plan.full, plan.reason, plan.routes)
	}
}

// TestRouteGraphNotReady covers the two states that predate any graph at all.
func TestRouteGraphNotReady(t *testing.T) {
	var nilGraph *routeGraph
	if plan := nilGraph.classify("/tmp", []string{"/tmp/x.pzl"}, nil); !plan.full {
		t.Error("a nil graph must classify as a full render")
	}
	if plan := (&routeGraph{}).classify("/tmp", []string{"/tmp/x.pzl"}, nil); !plan.full {
		t.Error("an uncaptured graph must classify as a full render")
	}
}

func TestBuildRouteGraphRejectsBadMetafile(t *testing.T) {
	if _, err := buildRouteGraph("{", "/tmp", "{}", "/tmp", nil, nil); err == nil {
		t.Error("a malformed pages metafile must be an error, so the caller keeps the previous graph")
	}
	if _, err := buildRouteGraph("{}", "/tmp", "not json", "/tmp", nil, nil); err == nil {
		t.Error("a malformed prerender metafile must be an error")
	}
}

// TestRenderWideFallsBackWhole covers the guardrails: every way the cut walk can
// fail to describe the prerender graph has to land on "the whole graph is
// render-wide", because that is the only answer that cannot under-render.
func TestRenderWideFallsBackWhole(t *testing.T) {
	pre := map[string][]string{
		"/app/entry.js": {"/app/app.js"},
		"/app/app.js":   {"/app/views/A.pzl"},
		"/app/views/A.pzl": {
			"/app/lib/helper.js",
		},
		"/app/lib/helper.js": {},
	}
	whole := func(name string, got map[string]bool) {
		t.Helper()
		if len(got) != len(pre) {
			t.Errorf("%s: %d render-wide modules, want all %d", name, len(got), len(pre))
			return
		}
		for mod := range pre {
			if !got[mod] {
				t.Errorf("%s: %s is not render-wide", name, mod)
			}
		}
	}

	whole("no chain roots", renderWide(pre, nil))
	whole("empty chain roots", renderWide(pre, map[string]bool{}))

	// A cycle spanning every module leaves nothing with in-degree zero, so there
	// is no honest place to start walking.
	cyclic := map[string][]string{"/a.js": {"/b.js"}, "/b.js": {"/a.js"}}
	got := renderWide(cyclic, map[string]bool{"/c.pzl": true})
	if len(got) != 2 || !got["/a.js"] || !got["/b.js"] {
		t.Errorf("a rootless graph must be wholly render-wide, got %v", got)
	}

	// The healthy shape, for contrast: the walk stops at the chain root, so the
	// helper below it is NOT render-wide and neither is the chain root itself.
	got = renderWide(pre, map[string]bool{"/app/views/A.pzl": true})
	want := map[string]bool{"/app/entry.js": true, "/app/app.js": true}
	if len(got) != len(want) {
		t.Fatalf("cut walk produced %v, want %v", got, want)
	}
	for mod := range want {
		if !got[mod] {
			t.Errorf("cut walk lost %s (got %v)", mod, got)
		}
	}
}
