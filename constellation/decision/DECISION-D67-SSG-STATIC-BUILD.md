---
name: "D67 — Static site generation as an additive build output mode"
status: verified
verified_at: '2026-07-22T01:03:46.828Z'
connections:
  - DECISION-D01-SPA-ONLY
  - DECISION-D79-STATIC-PAGES-MODE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - FEATURE-V1-33-SSG
notes:
  - kind: state
    text: >-
      RENAMED by D79 (v1.46). The mode this card describes — prerendered pages + the full
      SPA bundle + router takeover at navigation #0 — is now spelled `output: 'hybrid'` /
      `puzzle build --hybrid` (behavior byte-identical). `output: 'static'` / `--static`
      now means a DIFFERENT true-static mode (no router, no app.js, per-page mount module):
      see [[DECISION-D79-STATIC-PAGES-MODE]] and SPEC §36. Read every `output: 'static'` /
      `--static` / `data-puzzle-ssg` reference below as the hybrid mode.
  - kind: state
    text: >-
      Two SSG runtime touch-ups from the July 2026 pre-release hardening. (1) beforeMount RECEIVER
      parity: the { store, config } facade (this card's arg contract unchanged) is now ALSO the call
      receiver — ssg/index.js does beforeMount.call(facade, facade), matching the browser's
      beforeMount.call(app, app), so a hook that uses `this` behaves identically at build time and
      runtime. (2) The ViewNode→HTML serializer (client-runtime/ssg/serialize.js) emits '' for the
      new PLACEHOLDER_TAG ('#') arity-padding vnodes that codegen now injects into
      {#if}/{#unless}/{#case} branches (see COMPONENT-VIEW-MANAGER / COMPONENT-CODEGEN), so
      prerendered HTML is unaffected by the padding.
---

# D67 — Static site generation as an additive build output mode

`puzzle build --static` (or `output: 'static'` in puzzle.config.js) prerenders every static route to its own `dist/<path>/index.html` — content-complete, SEO-visible, styled before JS — and the unchanged SPA runtime takes over on load so subsequent navigation (routing, transitions, morph) is byte-identical to a normal Puzzle app.

## Context

Docs/marketing sites built as Puzzle SPAs (the puzzle-pieces demo: ~44 routes, one per piece) ship a single empty `index.html` — no per-URL content for crawlers, link unfurlers, or JS-less first paint. [[DECISION-D01-SPA-ONLY]] rejected SSR/hydration for the RUNTIME; it never precluded a BUILD-TIME render. The enabling facts: compiled `.pzl` output is pure ViewNode-tree data (no DOM calls), `PuzzleView.preload()` already runs `created()` + awaited `data()` with no DOM and no `mounted()`/animations, and slot expansion (`expandSlots`) is pure ViewNode code.

## Decision

Ship SSG as three additive pieces, leaving parser/codegen and D1's no-server posture untouched:

1. **A pure ViewNode→HTML serializer + prerender orchestrator** (`client-runtime/ssg/`, exported as `@magic-spells/puzzle/ssg`, Node-only). Chains are loaded via `preload()` and serialized; the serializer mirrors ViewManager semantics (shared `expandSlots`; `@event`/`key`/`island` dropped; `{#svg}` seeds verbatim; scoped-style stamps pass through). Shell injection is string surgery on the built `index.html` (`data-puzzle-ssg` marker + `meta.title` title).
2. **A Go build step** (`compiler/internal/build/prerender.go`): a second node-platform esbuild bundle of a generated entry importing the app's default export, run under `node` once, summary via the `__PUZZLE_SSG_JSON__` stdout sentinel; failure fails the build before the staging→dist swap.
3. **Router takeover**: at navigation #0 a `data-puzzle-ssg`-marked container is cleared inside the commit window with `skipEnter()` suppression — no flash, no duplication, unmarked apps byte-identical. Plus one matching amendment: a single trailing `/` is insignificant (static hosts serve directory URLs).

Requirements it imposes: `app/app.js` must `export default app`; `config.target` must be a `#id` selector with an empty element in the shell; user module scope must be Node-importable (browser globals guarded). Dynamic routes are skipped with a warning in v1; `prerender: false` in a chain writes the plain shell (SPA island). The v1.34 follow-up (within this decision's scope — it was on the documented follow-up list): the `path: '*'` catch-all renders to `dist/404.html`, a catch-all-less static build warns, and the `puzzle init` templates ship a wired `NotFound.pzl`.

## Alternatives rejected

- **Driving ViewManager under jsdom/linkedom and reading innerHTML** — fires `mounted()`/animations (exactly what must not run at build time); suppressing them means forking ViewManager anyway; adds a DOM-shim dependency. The serializer is ~160 lines against a stable vnode contract.
- **True DOM-adoption hydration in v1** — substantial ViewManager surgery (claiming prerendered nodes into vnode.el); replace-on-commit is flash-free already since the markup is identical and the swap is same-paint. Adoption stays the follow-up upgrade path.
- **Per-route JS bundles / inlining JS into each page** — splitting needs lazy `view: () => import()` router support (its own feature); inlining kills cross-page caching of the one bundle. One shared `/app.js` on every page wins for v1.
- **Flat `name.html` output** — URLs would diverge from the SPA route paths, breaking takeover navigation and needing host rewrites. Directory-style `name/index.html` keeps URLs identical to the route table (config knob deferred).
- **File-based page discovery** — routes.js is already the page manifest; no second convention needed.

## Consequences

A Puzzle app opts into per-URL static HTML with zero source changes beyond `export default app` (scaffold convention). `data()` runs once per page in Node at build time (Astro-frontmatter policy — documented). The serializer must track ViewManager attr semantics — guarded by an equivalence suite asserting serializer output === jsdom-mounted innerHTML. D1 stands for the runtime: no server, no hydration protocol, one runtime code path after takeover.
