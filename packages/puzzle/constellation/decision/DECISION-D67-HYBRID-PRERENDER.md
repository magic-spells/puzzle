---
name: D67 — Build-time prerendering; the hybrid output mode (prerendered pages + SPA takeover)
status: verified
verified_at: '2026-11-01T19:23:12.785Z'
connections:
  - DECISION-D01-SPA-ONLY
  - DECISION-D81-STATIC-PAGES-MODE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
code_refs:
  - client-runtime/ssg/index.js
  - client-runtime/ssg/serialize.js
  - client-runtime/router/router.js
  - compiler/internal/build/prerender.go
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D67 — Build-time prerendering; the hybrid output mode

`output: 'hybrid'` (`puzzle build --hybrid`) prerenders every static route to `dist/<path>/index.html` — content-complete, crawlable, styled before JS — and the normal SPA runtime takes over on load. `output: 'static'` is the router-free sibling ([[DECISION-D81-STATIC-PAGES-MODE]]); both share the prerenderer, serializer and `assembleChain`.

D1 rejected SSR/hydration for the runtime, not a build-time render: compiled `.pzl` output is pure ViewNode data, `PuzzleView.preload()` runs `created()` + awaited `data()` with no DOM and no `mounted()`/animations, and slot expansion is pure ViewNode code — so a build can render pages without a DOM.

## Decision

1. **Serializer + orchestrator** (`client-runtime/ssg/`, the Node-only `@magic-spells/puzzle/ssg` subpath). Chains are assembled and preloaded exactly as the router would, then serialized. The serializer mirrors ViewManager semantics (shared `expandSlots`; `@event`/`key`/`island`/`ref` dropped; `{#svg}` verbatim; scoped-style stamps kept; RAWTEXT per D113). The shell gets the markup, the resolved `<title>` and managed head tags (D84) by string surgery keyed on the target id, plus the `data-puzzle-ssg` marker.
2. **Go build step** (`compiler/internal/build/prerender.go`): a node-platform esbuild bundle of a generated entry importing the app entry's default export, run under `node` once; the summary comes back through the `__PUZZLE_SSG_JSON__` stdout sentinel. A failure fails the build before the staging→dist swap.
3. **Router takeover:** at navigation #0 a `data-puzzle-ssg`-marked container is cleared inside the commit window with `skipEnter()` — no flash, no duplication. A single trailing `/` is insignificant (static hosts serve directory URLs).

Requirements: the app entry (`app/app.js` / `app/app.ts`) must `export default app`; `config.target` must be a `#id` selector naming an empty element in the shell; user module scope must be Node-importable (guard browser globals). Hybrid is **path routing only**: `prerender()` throws when `routerMode` is set (a hash/memory router boots at `/` and would render home over every page) — non-path apps use `output: 'static'`.

Route handling (both modes):
- A `:param` route is prerendered once per `staticPaths` entry (D179); without one it is skipped with a warning.
- `prerender: false` anywhere in a chain writes the plain shell (a client-rendered page).
- The bare `path: '*'` catch-all renders to `dist/404.html`; a build without one warns.
- Every page gets its own build-time ctx and fresh store; `data()` runs once per page in Node.
- The build-time `beforeMount` runs on that fresh store, receiving a `{ store, config }` facade (plus `locale` under i18n) as both argument and `this`.

## Alternatives rejected

- **Drive ViewManager under jsdom/linkedom and read innerHTML** — fires `mounted()`/animations, which must not run at build time, and adds a DOM shim.
- **DOM-adoption hydration** — not needed: replace-on-commit is already flash-free because the markup is identical and the swap is same-paint.
- **Flat `name.html` output** — URLs would diverge from route paths and need host rewrites.
- **File-based page discovery** — `routes.js` is the page manifest.

## Gotchas

- The serializer must track ViewManager attribute semantics; an equivalence suite asserts serializer output equals jsdom-mounted innerHTML.
- D1 stands: no server, no hydration protocol, one runtime code path after takeover.
