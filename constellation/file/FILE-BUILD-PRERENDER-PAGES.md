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
verified_at: '2026-07-24T23:40:00.000Z'
verified_sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
---

Source binding for the owning component card. Behavioral intent stays in the connected component ([[COMPONENT-SSG]], static mode of [[DECISION-D81-STATIC-PAGES-MODE]]); this card anchors that plan to `compiler/internal/build/prerender_pages.go`. Generates one `dist/_puzzle/<slug>.js` mountStatic entry per written page (keyed on the codegen `__pzlModule` stamps), derives slugs + suffixes collisions, detects models/formatters modules and warns on app.js-only formatters, and drops `staging/app.js`.

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
