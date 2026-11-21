---
name: SSG route orchestrator
status: verified
path: client-runtime/ssg/index.js
language: javascript
summary: Static-route enumeration, preload, shell injection, and output planning.
connections:
  - COMPONENT-SSG
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# ssg/index.js

The `@magic-spells/puzzle/ssg` export: the prerender orchestrator behind `output: 'hybrid'` and `output: 'static'` ([[COMPONENT-SSG]]). **Node-only** — it reads and writes files through `node:fs`. The Go build bundles it beside the app's `app/app.js` and calls `prerenderToDir(app.config, …)`; `prerender()` is the filesystem-free core tests use.

It wires the same ctx `PuzzleApp.mount()` wires (Store, function registry, an unstarted `memoryRouter()` Router), enumerates leaves through `routeTree.js` (`enumerateRoutes`), assembles each page through `ssg/assemble.js`, serializes it with `ssg/serialize.js`, and injects markup, title and managed head tags (D84) into the shell (`injectShell`, `injectStaticShell`).

- A route with a `:param` segment renders one page per `staticPaths` entry (D179) and is skipped with a warning without one.
- The bare top-level `*` catch-all writes `404.html`; a `prerender: false` route gets the untouched shell at its path.
- Managed head tags are written only here; the browser syncs `<title>` alone.
