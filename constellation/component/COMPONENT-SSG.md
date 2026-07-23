---
name: Static generation runtime
status: verified
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D80-STATIC-PAGES-MODE
  - FEATURE-V1-33-SSG
  - FEATURE-V1-47-STATIC-PAGES
  - FILE-SSG-RUNTIME
  - FILE-SSG-SERIALIZER
  - FILE-SSG-ASSEMBLE
  - FILE-STATIC-MOUNT
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
verified_at: '2026-07-23T00:00:00.000Z'
---

# Static generation runtime

Puzzle prerenders routes to static HTML at build time in **two output modes** — `output: 'hybrid'` and `output: 'static'` — sharing one serializer, one prerender orchestrator, and one chain assembler. Neither introduces an SSR server or a hydration protocol (D1 holds for both). `puzzle dev` and a plain `puzzle build` are unaffected.

## Shared prerender core

`@magic-spells/puzzle/ssg` turns PuzzleApp config + compiled ViewNode trees into static HTML. `prerender()` is DOM/filesystem-free; `prerenderToDir()` writes output for the Go build's node-platform prerender bundle. The orchestrator builds Store/Router/Formatter services, calls `beforeMount` with one `{ store, config }` facade (receiver and argument), enumerates static route chains, and — via the shared `assembleChain` (`ssg/assemble.js`) — preloads each chain's layout/views (`created()` + awaited `data()`, `this.route` populated, no `mounted()`/animations) and builds the nested keyed component vnode tree exactly as the router's `#navigate` does. Titles resolve leaf → root. The serializer (`ssg/serialize.js`) mirrors ViewManager semantics: escaped text/attrs, controlled form initial state, inline components without wrappers, shared slot expansion, SVG string seeds verbatim, and framework attrs/events/keys/islands/refs omitted; conditional placeholder vnodes serialize to nothing. Static paths write directory-style `<path>/index.html`; a top-level catch-all writes `404.html`; dynamic parameter/splat routes are skipped with warnings; `prerender: false` writes the plain shell at that path.

## Hybrid mode (`output: 'hybrid'`, D67)

The original prerender mode, formerly spelled `output: 'static'` and renamed by D80 (behavior byte-identical). Each page is the prerendered markup **plus** the shared `/app.js` SPA bundle. Shell injection stamps `data-puzzle-ssg` on the empty `#id` target, injects title/content, and containment-checks every path. The browser [[COMPONENT-ROUTER]] recognizes the `data-puzzle-ssg` marker at navigation zero, replaces the prerendered children in its commit window, removes the marker, and skips the initial enter — after which the site is an ordinary SPA (routing, transitions, morph unchanged). Choose hybrid for apps that want prerendered first paint and instant client-side navigation afterward.

## Static mode (`output: 'static'`, D80)

A **true static site**: no router, no SPA takeover, no history API in the output — navigation is plain `<a>` page loads and `dist/` ships no `app.js`. The build ([[FILE-BUILD-PRERENDER-PAGES]]) generates one per-page ES module `dist/_puzzle/<slug>.js` (slug: `/`→`index`, `*`→`404`, else path `/`→`--`, collisions suffixed) that imports `mountStatic` from `@magic-spells/puzzle/static` plus exactly that page's view/layout/component classes — resolved through the codegen `__pzlModule` stamp on every class. esbuild code-splitting factors shared components + the router-free view-layer runtime into `dist/_puzzle/chunks/`. Shell injection (`injectStaticShell`) stamps `data-puzzle-static` on the target, serializes each page's context store (`store._serializeAll()`) into an inline `<script type="application/json" data-puzzle-static-data>` island, swaps the `/app.js` tag for the page's module, and drops `staging/app.js`. `beforeMount` runs only at build time.

The static browser kernel ([[FILE-STATIC-MOUNT]], `mountStatic`) wires the same build-time ctx (Store + FormatterRegistry; `ctx.router` is a throwing stub), rehydrates the data island in replace mode, assembles + preloads the chain via the same `assembleChain`, calls `skipEnter()` on every instance, then `replaceChildren()` + mounts the tree over the prerendered markup — flash-free because it re-renders identically from the same data. `prerender: false` writes an empty-target shell (no marker) that still ships a data island + entry module and renders fully client-side (a client-rendered island). `models` load from `app/models/index.js` and `formatters` from `app/formatters.js` when present; formatters registered only in the app.js config warn (build-time only, missing client-side).
