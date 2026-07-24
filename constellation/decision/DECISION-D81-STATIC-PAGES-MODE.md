---
name: "D81 — True static-pages output mode; old mode renamed 'hybrid'"
status: verified
verified_at: '2026-07-24T05:49:33.869Z'
connections:
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D01-SPA-ONLY
  - COMPONENT-SSG
  - COMPONENT-CODEGEN
  - DOC-SPEC
  - FEATURE-V1-47-STATIC-PAGES
  - FILE-STATIC-MOUNT
  - FILE-SSG-ASSEMBLE
  - FILE-BUILD-PRERENDER-PAGES
notes:
  - kind: decision
    text: >-
      Prerender/hydration router-facade parity + base-prefix (2026-07-24). The static-mode prerender
      ctx.router was an unstarted no-base memory Router (current=null, url() unprefixed) while the
      client kernel used a base/mode-aware stub — so `{ path | link }` rendered DIFFERENT hrefs at
      build vs client for any hash-mode or based app. Fix: makeRouterStub + normalizeBase MOVED to
      the shared ssg/assemble.js; static-mode buildContext now builds ctx.router from that SAME stub
      over the per-page route snapshot, so router.url()/current byte-match both phases. Hybrid keeps
      the real unstarted memory Router (the SPA boots and takes over). Also: injectStaticShell now
      prefixes the injected `/_puzzle/<slug>.js` script with the normalized routerBase so a subpath
      deploy resolves it (the shell's own asset hrefs — styles.css, favicon — stay the app author's
      responsibility under a base).
    sha: d9591d6
  - kind: decision
    text: >-
      Two more static/hybrid policies (2026-07-24). (1) HYBRID IS HISTORY-MODE ONLY: hybrid
      prerenders path-shaped files, but a hash/memory router boots at '/' and renders the home route
      over every prerendered page. routerMode is PuzzleApp runtime config the Go build can't
      inspect, so prerender() now THROWS for mode==='hybrid' with routerMode 'hash'|'memory' (fails
      the Go build) — a non-history app must use output:'static'. (2) STATIC IGNORES STORAGE:
      config.storage is a live object that JSON-serializes to a dead `{}` across the build→summary
      boundary; the Store then treats `{}` as truthy and its persistence calls no-op silently. So a
      static build no longer threads storage (dropped from the summary + the Go staticSummary struct
      + staticEntrySource) and WARNS when config.storage is set. A direct mountStatic({storage})
      caller still gets real persistence (the param stays on mountStatic/buildStaticContext).
    sha: d9591d6
verified_sha: d9591d6e01cb9c358acfa4d641174d08e1f05b23
---

# D81 — True static-pages output mode; old mode renamed 'hybrid'

`output: 'static'` now means a **true static site**: per-route content-complete HTML with **no router, no SPA takeover, and no history API** in the output — navigation is plain `<a>` page loads. Each page ships a small per-page ES module that mounts only its own components over the prerendered markup. The former `output: 'static'` behavior (prerendered pages + full SPA bundle + router takeover, D67) is renamed `output: 'hybrid'` / `puzzle build --hybrid`, byte-identical.

## Context

D67 shipped `output: 'static'` as a prerendered **SPA**: every page carries the whole `/app.js` bundle and the router adopts the prerendered DOM at navigation #0, driving all subsequent navigation client-side. Calling that "static" overstated it — a static site is one you can serve as flat files with no framework runtime deciding what to render. Users reaching for `output: 'static'` on a docs or marketing site got a full single-page-app bundle on every page and a router they never asked for. The word should mean what it says; the prerendered-SPA behavior is still valuable, but it is a different, heavier product than "static pages."

The enabling facts were already in place: compiled `.pzl` output is environment-agnostic ViewNode-tree data; `PuzzleView.preload()` runs `created()` + awaited `data()` with no DOM; and the chain-assembly the router's `#navigate` performs is pure ViewNode code. The one missing primitive was a way for the build to emit **per-page** JavaScript that imports exactly that page's classes — which requires each compiled class to know its own source module.

## Decision

Ship a second output mode beside `hybrid`, leaving parser semantics, D1's no-server posture, and the hybrid pipeline untouched:

1. **`__pzlModule` stamps (codegen).** Every compiled class is stamped with `Class.__pzlModule`, its app-root-relative source path. This is the only codegen change (goldens regenerated); it gives the Go build the identifier it needs to generate a per-page import graph.
2. **A per-page entry per written page** at `dist/_puzzle/<slug>.js` (slug: `'/'`→`index`, `'*'`→`404`, else path `/`→`--`, collisions suffixed `-2`,`-3`…). Each imports `mountStatic` from the new `@magic-spells/puzzle/static` subpath plus exactly that page's view/layout/component classes. esbuild code-splitting factors shared components + the router-free view-layer runtime (PuzzleView/ViewNode/viewManager/store/formatters) into cached chunks under `dist/_puzzle/chunks/`.
3. **The static browser kernel** (`client-runtime/static/index.js`, `mountStatic`): wires the same build-time ctx the prerenderer wired (Store + FormatterRegistry — `ctx.router` is a throwing stub), rehydrates the inline data island, assembles + preloads the chain via the **shared** `assembleChain`, skips enter animations, and replaces the prerendered children flash-free. No router, no history, no `beforeMount` (build-time only).
4. **Shared chain assembly** (`client-runtime/ssg/assemble.js`, `assembleChain`): extracted DOM-free layout+view chain assembly used by both the prerenderer and the kernel, so the client tree matches the prerendered markup exactly.
5. **Build-time data policy.** `beforeMount` runs only at build time; each page's context store is serialized (`store._serializeAll()`) into an inline `<script type="application/json" data-puzzle-static-data>` island; `mountStatic` rehydrates it (replace mode) before preloading, so `data()` re-renders identically with no network. The target element is stamped `data-puzzle-static` (not `data-puzzle-ssg` — nothing takes these pages over). The shell's `/app.js` script tag is stripped; `dist/` contains no `app.js`.
6. **The Go static pipeline** (`compiler/internal/build/prerender_pages.go`), plus `output: 'static'|'hybrid'` in config, `--static`/`--hybrid` CLI flags (mutually exclusive; a flag disagreeing with a config value is an error), and the renamed `prerenderHybrid`.

`prerender: false` in static mode writes an empty-target shell that still gets a data island + entry script and renders fully client-side (a client-rendered island, no router). `models` load from `app/models/index.js` and `formatters` from `app/formatters.js` when present; formatters registered only in the app.js config trigger a build warning (available at build time, missing client-side). Dynamic `:param` routes are still skipped with a warning; the `path: '*'` catch-all still renders to `dist/404.html`.

## Alternatives rejected

- **A single shared static bundle importing `routes.js`** — pulls every view into every page's graph, defeating the per-page-cost goal. The `__pzlModule` stamps exist precisely to build a per-page import graph instead.
- **True zero-JS output** — kills component interactivity (the counter, the playground), which is the point of shipping a component framework. Noted as a possible future per-route opt-out.
- **Astro-style per-component partial hydration** — there is no per-component compilation unit to hydrate independently (a `.pzl` compiles to one class + render fn); building one is far larger scope.
- **Re-running `beforeMount` in the browser** — would refetch CMS/build-time data and could leak build-time credentials into the client. The data island keeps the Astro-frontmatter policy build-side and rehydrates the result instead.
- **Keeping the name `static` for the prerendered-SPA mode** — the rename is the whole point; `hybrid` names it honestly (static shell + SPA runtime).

## Consequences

`output: 'static'` is now the honest static-site story: flat files, plain-link navigation, minimal per-page JS, deployable to any static host. `output: 'hybrid'` preserves the D67 prerendered-SPA behavior byte-identically for apps that want client-side navigation/transitions/morph after first paint. D1 still holds for both: no SSR server, no hydration protocol. The two modes share the prerenderer, the serializer, and `assembleChain`, so a prerendered page and its client render cannot silently diverge. Measured on `examples/static-docs`: per-page entries ~1.2–3 KB, the shared runtime chunk ~35 KB raw, and no `app.js` in `dist/`.
