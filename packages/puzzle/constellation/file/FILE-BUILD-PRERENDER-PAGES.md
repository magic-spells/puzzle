---
name: Go static-pages build step
status: verified
path: compiler/internal/build/prerender_pages.go
language: go
summary: True-static pipeline — per-page entry generation, slug/collision rules, app.js removal.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-SSG
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D179-STATIC-PATHS
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# prerender_pages.go

The `output: 'static'` pipeline ([[DECISION-D81-STATIC-PAGES-MODE]],
[[COMPONENT-SSG]]): one `dist/_puzzle/<slug>.js` `mountStatic` entry per written
page (keyed on the codegen `__pzlModule` stamps), slug derivation with collision
suffixes, models/formatters/adapter module detection (`findStaticModule` probes
`.ts` variants as well as `.js`), warnings for app.js-only formatters and a
missing models module, and removal of `staging/app.js`. The pass runs with
`Splitting` on, so shared code lands in `_puzzle/chunks/`, and picks its
source-map mode up front from `staticPagesSourcemap(cfg, dev)`.

The adapter capability reaches a page through three tiers, cheapest first: no
adapter; a conventional `app/adapter.js`/`.ts` the entry imports directly; and,
when the capability is reachable only from `app.js`, a capture-mode import of the
app entry — which pulls the route table and every view into the shared chunk and
so prints a steering note. An inline `adapter.defaults()` in `app.js` must keep
working through that capture tier.

**Generated pages** ([[DECISION-D179-STATIC-PATHS]]): `staticPage.Pattern` is set
on a page a `staticPaths` route generated — the route's full path
(`/blog/:slug`) beside the page's own `Path`. All of a route's pages share one
entry and its pattern-shaped route JSON; for those entries only, the route literal
becomes an `Object.assign` with the page's `data-puzzle-static-route` island, so
fixed-route entries stay byte-identical. `routeKey()` (Pattern, else Path) is the
route a page belongs to — the unit the dev builder's route graph and D155 `only`
filter name (`watch_static.go`), since the prerender matches `only` against route
paths, never generated page paths.

Two load-bearing shapes that are easy to undo:

- **The generated entry must end with `.catch(console.error)`.** `mountStatic` is
  async and nothing awaits it; a missing target or a throwing `data()` during
  rehydration would otherwise be an unobserved rejection — while the prerendered
  markup is still on screen, so the page LOOKS right and nothing is interactive.
- **`absModuleImport` passes an already-absolute path through.** `plugin.relName`
  falls back to the absolute path when a `.pzl` resolves outside the app root
  (symlinked `node_modules`, monorepos); joining that onto `absRoot` yields
  `<absRoot>/Users/…` and fails the per-page pass with "Could not resolve".
