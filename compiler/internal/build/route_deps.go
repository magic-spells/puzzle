package build

// route_deps.go — the reverse dependency graph and change classifier behind
// route-level invalidation in static dev (D155).
//
// The question a warm rebuild wants answered is: given the files this save
// touched, which prerendered pages can possibly look different? Two esbuild
// metafiles answer it between them.
//
//   - The PER-PAGE pass's metafile is a module graph rooted at one generated
//     entry per route. Walking it from each entry gives module → the routes
//     whose page bundle (and therefore whose rendered chain) contains it. A file
//     in this set is attributable: only its routes can change.
//   - The PRERENDER bundle's metafile is the graph rooted at the app entry —
//     app.js, routes.js, the models registry, the formatters module, every
//     lifecycle hook, and transitively every view. A file that is in THIS graph
//     but in no page graph is global to the render: it can move `beforeMount`,
//     the route table, the store seed, or the formatter set, and every page's
//     markup and data island with it. That is a full render, always.
//
// Everything else is decided by the most conservative rule that fits, because
// the cost of being wrong is asymmetric: a needless re-render costs
// milliseconds, a missed one ships a dev server that disagrees with the build.
// So an unknown path is a full render, a vanished path is a full render, and a
// graph that could not be built at all is a full render.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// routeGraph is the reverse dependency graph captured after a successful
// rebuild. The zero value is the "nothing known yet" state and classifies every
// change as a full render.
type routeGraph struct {
	// byModule maps a symlink-resolved absolute module path to the set of route
	// paths whose per-page entry graph reaches it.
	byModule map[string]map[string]bool
	// global is the set of modules in the prerender bundle that no page entry
	// reaches — the render-wide inputs.
	global map[string]bool
	// ready is false until both halves have been captured at least once.
	ready bool
}

// renderPlan is the classifier's verdict for one change batch.
type renderPlan struct {
	// full requests the unconditional render of every route.
	full bool
	// routes is the subset to render when full is false. It may be EMPTY, which
	// is a real and useful answer: a public asset edit changes the staging tree
	// without changing a single page.
	routes []string
	// reason names the rule that decided, for the profile row.
	reason string
}

// fullRender is the always-correct plan.
func fullRender(reason string) renderPlan { return renderPlan{full: true, reason: reason} }

// resolvedPaths memoizes resolvePath for the life of the process. Building the
// graph resolves every metafile input AND every import edge — several thousand
// paths on a real site — and filepath.EvalSymlinks costs a stat per path
// component, which made graph construction the most expensive phase of a warm
// rebuild by a wide margin. The tree a dev session watches does not move under
// it, and a wrong answer here can only mis-attribute a path (the classifier
// falls back to a full render for anything it cannot place), so the memo is
// unbounded and never invalidated.
var resolvedPaths sync.Map

// resolvePath normalizes a path the way both the compile cache and the plugin
// do — absolute, symlinks resolved — so a watcher's spelling (/var/…) and
// esbuild's (/private/var/…) land on the same key. A path that cannot be
// resolved (typically because it was just deleted) keeps its absolute form and
// is NOT memoized: the next save may well have created it.
func resolvePath(p string) string {
	if hit, ok := resolvedPaths.Load(p); ok {
		return hit.(string)
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		abs = p
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return abs
	}
	resolvedPaths.Store(p, real)
	return real
}

// buildRouteGraph walks the two metafiles into a routeGraph. entryRoutes maps
// each generated per-page entry file (absolute) to its route path; pagesBase and
// preBase are the working directories the respective passes resolved their
// metafile input keys against. An unparseable metafile is an error, and the
// caller keeps the previous graph rather than trusting a partial one.
func buildRouteGraph(pagesMetafile, pagesBase, preMetafile, preBase string, entryRoutes map[string]string) (*routeGraph, error) {
	pageInputs, err := metafileGraph(pagesMetafile, pagesBase)
	if err != nil {
		return nil, err
	}
	preInputs, err := metafileGraph(preMetafile, preBase)
	if err != nil {
		return nil, err
	}

	byModule := make(map[string]map[string]bool, len(pageInputs))
	for entry, route := range entryRoutes {
		for _, mod := range reachable(pageInputs, resolvePath(entry)) {
			set := byModule[mod]
			if set == nil {
				set = map[string]bool{}
				byModule[mod] = set
			}
			set[route] = true
		}
	}

	global := make(map[string]bool, len(preInputs))
	for mod := range preInputs {
		if _, attributed := byModule[mod]; !attributed {
			global[mod] = true
		}
	}

	return &routeGraph{byModule: byModule, global: global, ready: true}, nil
}

// metafileGraph parses an esbuild metafile into module → imported modules, with
// every path resolved to an absolute, symlink-normalized form against base (the
// pass's AbsWorkingDir, or the process cwd when it set none). External and
// namespaced virtual imports resolve to paths that exist in no graph and are
// harmless: nothing ever looks them up.
func metafileGraph(metafileJSON, base string) (map[string][]string, error) {
	var mf struct {
		Inputs map[string]struct {
			Imports []struct {
				Path     string `json:"path"`
				External bool   `json:"external"`
			} `json:"imports"`
		} `json:"inputs"`
	}
	if err := json.Unmarshal([]byte(metafileJSON), &mf); err != nil {
		return nil, err
	}
	resolveKey := func(key string) string {
		if filepath.IsAbs(key) {
			return resolvePath(key)
		}
		return resolvePath(filepath.Join(base, filepath.FromSlash(key)))
	}
	out := make(map[string][]string, len(mf.Inputs))
	for key, in := range mf.Inputs {
		deps := make([]string, 0, len(in.Imports))
		for _, imp := range in.Imports {
			if imp.External {
				continue
			}
			deps = append(deps, resolveKey(imp.Path))
		}
		out[resolveKey(key)] = deps
	}
	return out, nil
}

// reachable returns every module reachable from root in the input graph,
// including root itself.
func reachable(graph map[string][]string, root string) []string {
	seen := map[string]bool{root: true}
	stack := []string{root}
	out := []string{root}
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, dep := range graph[cur] {
			if seen[dep] {
				continue
			}
			seen[dep] = true
			out = append(out, dep)
			stack = append(stack, dep)
		}
	}
	return out
}

// classify decides what a change batch requires. assetConsumers resolves an
// inlined-asset path to the .pzl files that inline it ({#svg}, which esbuild
// never sees); it may be nil.
//
// The batch verdict is the MOST CONSERVATIVE of its members: one path that
// demands a full render makes the whole batch one, regardless of what the
// others said.
func (g *routeGraph) classify(root string, changed []string, assetConsumers func([]string) []string) renderPlan {
	if g == nil || !g.ready {
		return fullRender("no dependency graph yet")
	}
	if len(changed) == 0 {
		return fullRender("no change list")
	}

	shell := resolvePath(filepath.Join(root, "app", "public", "index.html"))
	publicDir := resolvePath(filepath.Join(root, "app", "public")) + string(filepath.Separator)

	routes := map[string]bool{}
	// attribute records one path's routes, or reports that it cannot be
	// attributed at all.
	attribute := func(p string) bool {
		set, ok := g.byModule[p]
		if !ok {
			return false
		}
		for r := range set {
			routes[r] = true
		}
		return true
	}

	for _, raw := range changed {
		p := resolvePath(raw)

		// The shell is spliced into every page: its own edit reaches all of them.
		if p == shell {
			return fullRender("the app shell changed")
		}
		// Any other public asset is copied into staging verbatim and appears in no
		// page's HTML. It needs no render at all — which is why this test precedes
		// the existence check: a DELETED public asset is still just a copy that no
		// longer happens.
		if strings.HasPrefix(p, publicDir) {
			continue
		}
		// A path that no longer exists is a delete or a rename. Either can remove a
		// module the graph still believes in, so it is never partial.
		if _, err := os.Stat(p); err != nil {
			return fullRender("a source file was added, deleted, or renamed")
		}
		if attribute(p) {
			continue
		}
		if g.global[p] {
			return fullRender("a render-wide module changed (" + filepath.Base(p) + ")")
		}
		// Not a module. It may still be an asset a .pzl inlines with {#svg}, an
		// edge no metafile carries — ask the compile cache, then attribute the
		// consuming views.
		if assetConsumers != nil {
			if consumers := assetConsumers([]string{p}); len(consumers) > 0 {
				ok := true
				for _, c := range consumers {
					if !attribute(resolvePath(c)) {
						ok = false
					}
				}
				if !ok {
					return fullRender("an inlined asset reaches a module outside the page graph")
				}
				continue
			}
		}
		// Stylesheets are composed into styles.css on every rebuild whatever
		// happens here, and no page's HTML embeds them.
		if strings.EqualFold(filepath.Ext(p), ".css") {
			continue
		}
		return fullRender("an unknown file changed (" + filepath.Base(p) + ")")
	}

	out := make([]string, 0, len(routes))
	for r := range routes {
		out = append(out, r)
	}
	sort.Strings(out)
	return renderPlan{routes: out, reason: "route-level"}
}
