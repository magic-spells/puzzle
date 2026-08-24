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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]], static mode of [[DECISION-D81-STATIC-PAGES-MODE]]); this card anchors that plan to `compiler/internal/build/prerender_pages.go`. Generates one `dist/_puzzle/<slug>.js` mountStatic entry per written page (keyed on the codegen `__pzlModule` stamps), derives slugs + suffixes collisions, detects models/formatters/adapter modules (`findStaticModule` probes `.ts` variants as well as `.js`), warns on app.js-only formatters AND on a missing models module, and drops `staging/app.js`.

The adapter capability reaches a static page through three tiers, cheapest
first: no adapter at all; a conventional `app/adapter.js`/`.ts` the entry
imports directly; and — when the capability is only reachable from `app.js` —
a capture-mode import of the app entry, which pulls the route table and every
view into the shared page chunk and therefore prints a steering note. An
inline `adapter.defaults()` in `app.js` is legal and must keep working through
that capture tier. The pass runs with `Splitting` on, so shared code lands in
`_puzzle/chunks/` automatically, and it picks its source-map mode up front from
`staticPagesSourcemap(cfg, dev)` rather than emitting maps to delete later.

Two shapes here are load-bearing and easy to undo:

- **The generated entry must close with `.catch(console.error)`.** `mountStatic`
  is async and nothing awaits it, so a missing target or a throwing `data()`
  during rehydration would otherwise be an unobserved rejection — and the
  prerendered markup is still on screen at that point (`replaceChildren` has not
  run), so the page LOOKS correct while nothing is interactive.
- **`absModuleImport` passes an already-absolute path through untouched.**
  `plugin.relName` falls back to the absolute path whenever a `.pzl` resolves
  outside the app root (symlinked `node_modules`, monorepo layouts), and that
  value arrives here as the module stamp. Joining it onto `absRoot` yields
  `<absRoot>/Users/…`, failing the per-page esbuild pass with "Could not
  resolve" against a staging path the deferred cleanup has already removed.
