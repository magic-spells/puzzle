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
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# prerender_pages.go

The `output: 'static'` pipeline ([[DECISION-D81-STATIC-PAGES-MODE]],
[[COMPONENT-SSG]]): one `dist/_puzzle/<slug>.js` `mountStatic` entry per written
page (content-hashed in production under `build.hashNames`), keyed on the codegen
`__pzlModule` stamps; slug derivation with collision suffixes; detection of the
models/formatters/adapter modules (`findStaticModule` probes `.ts` as well as
`.js`) with warnings for app.js-only formatters and a missing models module; and
removal of `staging/app.js`. The pass runs with `Splitting` on, so shared code lands
in `_puzzle/chunks/`.

The adapter capability reaches a page through three tiers, cheapest first: none;
a conventional `app/adapter.js`/`.ts` the entry imports directly; and, when the
capability is reachable only from `app.js`, a capture-mode import of the app entry
— which pulls the route table and every view into the shared chunk, so it prints a
steering note. An inline `adapter.defaults()` in `app.js` must keep working through
that capture tier.

**Generated pages** ([[DECISION-D179-STATIC-PATHS]]): `staticPage.Pattern` is the
route path (`/blog/:slug`) of a page a `staticPaths` route generated. A route's
pages share one entry; for those entries only, the route literal becomes an
`Object.assign` with the page's `data-puzzle-static-route` island, so fixed-route
entries stay byte-identical. `routeKey()` (Pattern, else Path) is the unit the dev
route graph and the D155 `only` filter use (`watch_static.go`) — the prerender
matches `only` against route paths, never generated page paths.

Production: `rewriteStaticPages` maps each generated entry to its emitted output
and rewrites every page's HTML through [[FILE-BUILD-SHELL]] — locale and generated
pages sharing an entry included — and every production page preloads its
transitive static-import chunks, hashed or not. Development and the warm static
builder keep fixed names.

Easy to undo:

- **The generated entry must catch and log the `mountStatic` rejection.** It is
  async and nothing awaits it; a missing target or a throwing `data()` during
  rehydration would otherwise be an unobserved rejection while the prerendered
  markup is still on screen — the page LOOKS right and nothing is interactive.
- **`absModuleImport` passes an already-absolute path through.** `plugin.relName`
  returns the absolute path when a `.pzl` resolves outside the app root (symlinked
  `node_modules`, monorepos); joining it onto `absRoot` yields `<absRoot>/Users/…`
  and fails the page pass with "Could not resolve".
