---
name: SSG route orchestrator
status: verified
path: client-runtime/ssg/index.js
language: javascript
summary: Static-route enumeration, preload, shell injection, and output planning.
connections:
  - COMPONENT-SSG
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# ssg/index.js

The `@magic-spells/puzzle/ssg` export: the prerender orchestrator behind `output: 'hybrid'` and `output: 'static'` ([[COMPONENT-SSG]]). **Node-only** — it reads and writes files through `node:fs`. The Go build bundles it beside the app's `app/app.js` and calls `prerenderToDir(app.config, …)`; `prerender()` is the filesystem-free core tests use.

It wires the same ctx `PuzzleApp.mount()` wires (Store, function registry, a router), enumerates leaves through `routeTree.js` (`enumerateRoutes`), assembles each page through `ssg/assemble.js`, serializes it with `ssg/serialize.js`, and injects markup, title and managed head tags (D84) into the shell (`injectShell`, `injectStaticShell`). `createPageContext` builds the page's router stub (`makeRouterStub`) in both modes: a static page renders through it, and a hybrid page renders through the build's one unstarted `memoryRouter()` Router with the stub's `url()` copied onto it, so both modes write the same hrefs.

- A route with a `:param` segment renders one page per `staticPaths` entry (D179) and is skipped with a warning without one.
- The bare top-level `*` catch-all writes `404.html`; a `prerender: false` route gets the untouched shell at its path.
- Managed head tags are written only here; the browser syncs `<title>` alone.
