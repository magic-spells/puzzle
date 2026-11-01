---
name: SSG route orchestrator
status: verified
path: client-runtime/ssg/index.js
language: javascript
summary: Static-route enumeration, preload, shell injection, and output planning.
connections:
  - COMPONENT-SSG
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# ssg/index.js

The `@magic-spells/puzzle/ssg` export: the prerender orchestrator behind `output: 'hybrid'` and `output: 'static'` ([[COMPONENT-SSG]]). **Node-only** — it reads and writes files through `node:fs`. The Go build bundles it beside the app's `app/app.js` and calls `prerenderToDir(app.config, …)`; `prerender()` is the filesystem-free core tests use.

It wires the same ctx `PuzzleApp.mount()` wires (Store, function registry, an unstarted `memoryRouter()` Router), enumerates leaves through `routeTree.js` (`enumerateRoutes`), assembles each page through `ssg/assemble.js`, serializes it with `ssg/serialize.js`, and injects markup, title and managed head tags (D84) into the shell (`injectShell`, `injectStaticShell`).

- A route with a `:param` segment renders one page per `staticPaths` entry (D179) and is skipped with a warning without one.
- The bare top-level `*` catch-all writes `404.html`; a `prerender: false` route gets the untouched shell at its path.
- Managed head tags are written only here; the browser syncs `<title>` alone.
