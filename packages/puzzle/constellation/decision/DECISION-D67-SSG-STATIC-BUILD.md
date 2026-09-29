---
name: D67 — Build-time prerendering; the hybrid output mode (prerendered pages + SPA takeover)
status: verified
verified_at: '2026-07-22T01:03:46.828Z'
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
---

# D67 — Build-time prerendering; the hybrid output mode

`puzzle build --hybrid` (or `output: 'hybrid'`) prerenders every static route to
`dist/<path>/index.html` — content-complete, crawlable, styled before JS — and
the normal SPA runtime takes over on load, so later navigation (routing,
transitions, morph) is a normal Puzzle app. `output: 'static'` is the router-free
sibling mode ([[DECISION-D81-STATIC-PAGES-MODE]]); both share the prerenderer,
serializer and `assembleChain`.

## Context

D1 rejected SSR/hydration for the runtime, not a build-time render. Compiled
`.pzl` output is pure ViewNode data, `PuzzleView.preload()` runs `created()` +
awaited `data()` with no DOM and no `mounted()`/animations, and slot expansion is
pure ViewNode code — so a build can render pages without a DOM.

## Decision

1. **Serializer + orchestrator** (`client-runtime/ssg/`, the Node-only
   `@magic-spells/puzzle/ssg` subpath). Chains are assembled and preloaded
   exactly as the Router's `#navigate` would, then serialized; the serializer
   mirrors ViewManager semantics (shared `expandSlots`; `@event`/`key`/`island`
   dropped; `{#svg}` verbatim; scoped-style stamps kept; RAWTEXT per D113). The
   shell gets the markup, resolved `<title>` and managed head tags (D84/D111) by
   string surgery keyed on the target id, plus the `data-puzzle-ssg` marker.
2. **Go build step** (`compiler/internal/build/prerender.go`): a node-platform
   esbuild bundle of a generated entry importing the app entry's default export,
   run under `node` once, summary returned via the `__PUZZLE_SSG_JSON__` stdout
   sentinel. Failure fails the build before the staging→dist swap.
3. **Router takeover:** at navigation #0 a `data-puzzle-ssg`-marked container is
   cleared inside the commit window with `skipEnter()` — no flash, no
   duplication; unmarked apps are unaffected. A single trailing `/` is
   insignificant (static hosts serve directory URLs).

Requirements: the app entry (`app/app.js` or `app/app.ts`) must
`export default app`; `config.target` must be a `#id` selector with an empty
element in the shell; user module scope must be Node-importable (guard browser
globals). Hybrid is **path-mode only**: `prerender()` throws when `routerMode` is
set, because a hash/memory router boots at `/` and would render home over every
prerendered page — non-path apps use `output: 'static'`.

Route handling (both modes): dynamic `:param` routes are skipped with a warning;
`prerender: false` anywhere in a chain writes the plain shell (a client-rendered
island); the bare `path: '*'` catch-all renders to `dist/404.html`, and a build
without one warns. `data()` runs once per page in Node at build time. The
build-time `beforeMount` receives a `{ store, config }` facade as both argument
and `this`.

## Alternatives

- **Drive ViewManager under jsdom/linkedom and read innerHTML** — rejected: fires
  `mounted()`/animations, which must not run at build time, and adds a DOM shim.
- **DOM-adoption hydration** — deferred: replace-on-commit is already flash-free
  because markup is identical and the swap is same-paint.
- **Flat `name.html` output** — rejected: URLs would diverge from route paths
  and need host rewrites.
- **File-based page discovery** — rejected: `routes.js` is the page manifest.

## Consequences

- The serializer must track ViewManager attribute semantics; an equivalence
  suite asserts serializer output equals jsdom-mounted innerHTML.
- D1 stands: no server, no hydration protocol, one runtime code path after
  takeover.
