---
name: v1.47 — True static-pages output mode (D80)
status: verified
verified_at: '2026-07-23T00:00:00.000Z'
connections:
  - DECISION-D80-STATIC-PAGES-MODE
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D01-SPA-ONLY
  - COMPONENT-SSG
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - FILE-STATIC-MOUNT
  - FILE-SSG-ASSEMBLE
  - FILE-BUILD-PRERENDER-PAGES
---

# v1.47 — True static-pages output mode (D80)

`output: 'static'` / `puzzle build --static` becomes a **true static site**: per-route
content-complete HTML with no router, no SPA takeover, and no history API — plain
`<a>` navigation, no `app.js` in `dist/`. Each page ships a small per-page ES module
that mounts only its own components over the prerendered markup. The former D67
behavior (prerendered pages + full SPA bundle + router takeover) is renamed
`output: 'hybrid'` / `--hybrid`, byte-identical. Ship
[[DECISION-D80-STATIC-PAGES-MODE]].

## Scope

- In (runtime): NEW `client-runtime/static/index.js` (`mountStatic`: build-time ctx
  with a throwing router stub, data-island rehydrate in replace mode, chain
  assembly + preload, `skipEnter`, flash-free `replaceChildren`+mount) exported as
  `@magic-spells/puzzle/static` (+ `types/static.d.ts`); NEW
  `client-runtime/ssg/assemble.js` (`assembleChain` — the DOM-free layout+view
  chain assembly, extracted so the prerenderer and the kernel build the identical
  tree); `client-runtime/ssg/index.js` gains a `mode` option (`'hybrid'` default |
  `'static'`) and `injectStaticShell` (data-island + `data-puzzle-static` marker +
  per-page module tag, `/app.js` stripped).
- In (Go): `output: 'static'|'hybrid'` in config + `--static`/`--hybrid` flags
  (mutually exclusive; a flag disagreeing with the config value errors); NEW
  `compiler/internal/build/prerender_pages.go` (the static pipeline: per-page entry
  generation keyed on `__pzlModule`, slug derivation + collision suffixing, models/
  formatters detection + the app.js-only-formatters warning, `staging/app.js`
  removal); `prerender.go`'s D67 step renamed `prerenderHybrid`; the
  `@magic-spells/puzzle/static` in-repo esbuild alias (`build/options.go`).
- In (codegen): every compiled class stamped with `Class.__pzlModule` (its
  app-root-relative source path); goldens regenerated. The only codegen change.
- Out (deferred, unchanged from D67's list): `staticPaths()` for dynamic routes, a
  head-management API, DOM-adoption hydration, a true zero-JS per-route opt-out, and
  `puzzle preview`.

## Acceptance (all landed)

- `examples/static-docs` (`output: 'static'`): `puzzle build` writes per-route HTML +
  `dist/_puzzle/<slug>.js` per page + `dist/_puzzle/chunks/`, and **no** `app.js`.
  `dist/index.html` carries `<div id="app" data-puzzle-static>`, the inline
  `data-puzzle-static-data` island, and a `/_puzzle/index.js` module tag; the
  prerendered counter reads "Clicked 0 times" and comes alive on click via
  `mountStatic` (its `plural` formatter resolves client-side from
  `app/formatters.js`). Per-page entries ~1.2–3 KB, shared runtime chunk ~35 KB raw.
- `prerender: false` (`/playground`) writes an empty-target shell (`#app` unstamped)
  that still ships a data island + entry module and renders client-side.
- The `path: '*'` catch-all renders to `dist/404.html`; a dynamic `:param` route is
  skipped with a warning; formatters registered only in app.js config warn.
- `output: 'hybrid'` reproduces the D67 output byte-identically (prerendered pages +
  shared `app.js` + router takeover).
- Suite stays 840 vitest passed (static kernel + assemble + serialize/inject +
  slug/collision tests); Go build/config/CLI-flag tests green.
