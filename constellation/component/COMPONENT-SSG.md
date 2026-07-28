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
  - DECISION-D81-STATIC-PAGES-MODE
  - FEATURE-V1-33-SSG
  - FEATURE-V1-47-STATIC-PAGES
  - FILE-SSG-RUNTIME
  - FILE-SSG-SERIALIZER
  - FILE-SSG-ASSEMBLE
  - FILE-STATIC-MOUNT
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
verified_at: '2026-07-25T05:23:59.370Z'
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
notes:
  - kind: state
    text: >-
      Static/hybrid coherence pass (2026-07-24, see [[DECISION-D81-STATIC-PAGES-MODE]] notes).
      makeRouterStub + normalizeBase moved OUT of static/index.js into the shared ssg/assemble.js;
      static-mode buildContext builds ctx.router from that stub over the per-page snapshot
      (url()/current parity with the client kernel), hybrid keeps the real unstarted memory Router.
      injectStaticShell base-prefixes the injected `/_puzzle/<slug>.js` module by normalized
      routerBase (writeStaticDir threads it). prerender() throws for hybrid + hash|memory
      routerMode. The dead `storage` placeholder was removed from the static summary (+ Go
      staticSummary struct + staticEntrySource emission + a static+storage build warning). Tests:
      tests/static-prerender.test.js (facade parity, base-prefix, hybrid guard, storage warning),
      compiler static_pages_test.go.
    sha: d9591d6
  - kind: verified
    text: >-
      Re-verified after the deep-review round. Added the ctx.router section (static stub vs hybrid's
      url()-shadowed memory Router) and corrected the head prose: MANAGED_TAGS is now this pass's
      sole consumer, and normalizeBase/encodeURL live in router.js rather than assemble.js.
    sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
  - kind: verified
    text: >-
      Re-verified after D113: RAWTEXT branch + escapeScriptJson reviewed against the card's
      serializer prose; ssg suites and full runs green at merged main.
    sha: bf351981a2ed01bf1e9c21f30acc529959247221
---

# Static generation runtime

Puzzle prerenders routes to static HTML at build time in **two output modes** — `output: 'hybrid'` and `output: 'static'` — sharing one serializer, one prerender orchestrator, and one chain assembler. Neither introduces an SSR server or a hydration protocol (D1 holds for both). `puzzle dev` and a plain `puzzle build` are unaffected.

## Shared prerender core

`@magic-spells/puzzle/ssg` turns PuzzleApp config + compiled ViewNode trees into static HTML. `prerender()` is DOM/filesystem-free; `prerenderToDir()` writes output for the Go build's node-platform prerender bundle. The orchestrator builds Store/Router/Formatter services, calls `beforeMount` with one `{ store, config }` facade (receiver and argument), enumerates static route chains, and — via the shared `assembleChain` (`ssg/assemble.js`) — preloads each chain's layout/views (`created()` + awaited `data()`, `this.route` populated, no `mounted()`/animations) and builds the nested keyed component vnode tree exactly as the router's `#navigate` does — the frozen snapshot carries the D83 seven-key shape (`pathname` = the static path, empty frozen query, `''` hash). Head fields resolve leaf → root per field through the `head.js` resolver the router shares (D84); the `MANAGED_TAGS` table in `headTags.js` is **this pass's alone** — since D111 the browser syncs only `document.title`, so prerender is the one place managed tags are ever built. Pages carry `head` beside the compatibility `title`, and both shell injectors replace same-identity `data-puzzle-head` tags in place, remove suppressed ones, and insert the rest before `</head>` — escaped string surgery, no HTML parser; head-absent callers keep exact pre-D84 behavior. The serializer (`ssg/serialize.js`) mirrors ViewManager semantics: escaped text/attrs — except RAWTEXT ([[DECISION-D113-SSG-RAWTEXT-RULE]]): `<script>`/`<style>` text is never entity-escaped; JSON-typed scripts (`application/json` or `+json` suffix) emit with `<` escaped to `\u003c` through the `escapeScriptJson` helper the static data island shares, and other script/style content emits raw with the build failing on `</script`/`</style` or the `<!--`+`<script` double-escape pair — controlled form initial state, inline components without wrappers, shared slot expansion, SVG string seeds verbatim, and framework attrs/events/keys/islands/refs omitted; conditional placeholder vnodes serialize to nothing. Static paths write directory-style `<path>/index.html`; a top-level catch-all writes `404.html`; dynamic parameter/splat routes are skipped with warnings; `prerender: false` writes the plain shell at that path. Route guards (D87) are SPA-runtime-only, so the orchestrator warns — never changes behavior: hybrid warns per rendered page whose chain declares a guard (its markup ships publicly; `prerender: false` routes stay quiet), and a static build warns once when any route declares a guard (no router — guards never run).

### The prerender `ctx.router`

Both modes need a `router` in `ctx` that answers `url()` and `current` exactly
as the browser will, or a prerendered `href` (the `{ path | link }` formatter
reads `router.url`) disagrees with the client's re-render. **Static** mode uses
`makeRouterStub` over the page's route snapshot: every navigation method
throws, `current` is the snapshot, and `url()` is the shared encoder — with the
mode FORCED to `'history'` regardless of `config.routerMode`
([[DECISION-D117-STATIC-OUTPUT-HISTORY-HREFS]]): static pages are path-shaped
files with no router, so a hash-shaped href is dead; a configured hash/memory
mode gets a prerender warning, and `routerBase` still applies. **Hybrid**
keeps a real *unstarted memory-mode* `Router` — the SPA takeover needs the
compiled route table, and the instance cannot be wrapped in a delegating facade
because `current` reads private fields. Two instance properties are shadowed on
it ([[DECISION-D142-HYBRID-ROUTE-SNAPSHOT]]): `url()` with the app's real
`routerMode`/`routerBase` (a memory router returns paths unprefixed, so a
`routerBase: '/docs'` app would otherwise prerender `href="/about"` where the
live router renders `/docs/about` — a 404 for crawlers, no-JS visitors, and
anyone clicking before takeover), and `current` with the page's frozen route
snapshot (the same `makeRouteSnapshot` static mode threads into its stub), so
route-aware markup — active-nav classes, `current.params` reads — prerenders in
the same state the live router renders. The takeover replaces the instance, so
neither shadow outlives the prerender.

All three call sites (`Router.url`, the stub, the hybrid shadow) run the single
`encodeURL(path, mode, base)` exported from `router/router.js`, which also owns
`normalizeBase`. They were previously three hand-kept copies and had drifted;
one encoder is what makes prerender/client parity structural instead of
maintained.

## Hybrid mode (`output: 'hybrid'`, D67)

The original prerender mode, formerly spelled `output: 'static'` and renamed by D81 (behavior byte-identical). Each page is the prerendered markup **plus** the shared `/app.js` runtime bundle — the same SPA runtime, but since [[DECISION-D130-TAKEOVER-BUILD-DEFINE]] built with `__PUZZLE_TAKEOVER__=true`, so it is no longer byte-identical to a plain `puzzle build` bundle and the two are not interchangeable. Shell injection stamps `data-puzzle-ssg` on the empty `#id` target, injects title/content, and containment-checks every path. The browser [[COMPONENT-ROUTER]] recognizes the `data-puzzle-ssg` marker at navigation zero, replaces the prerendered children in its commit window, removes the marker, and skips the initial enter — for the routed chain AND the preloaded nested components (`preloadTakeoverComponents` returns the nested instances and the router `skipEnter()`s them after its supersede check; before that, nested `animations.in`/`viewWillShow` replayed over markup already on screen) — after which the site is an ordinary SPA (routing, transitions, morph unchanged). Choose hybrid for apps that want prerendered first paint and instant client-side navigation afterward.

## Static mode (`output: 'static'`, D81)

A **true static site**: no router, no SPA takeover, no history API in the output — navigation is plain `<a>` page loads and `dist/` ships no `app.js`. The build ([[FILE-BUILD-PRERENDER-PAGES]]) generates one per-page ES module `dist/_puzzle/<slug>.js` (slug: `/`→`index`, `*`→`404`, else path `/`→`--`, collisions suffixed) that imports `mountStatic` from `@magic-spells/puzzle/static` plus exactly that page's view/layout/component classes — resolved through the codegen `__pzlModule` stamp on every class. esbuild code-splitting factors shared components + the router-free view-layer runtime into `dist/_puzzle/chunks/`. Shell injection (`injectStaticShell`) stamps `data-puzzle-static` on the target, serializes each page's context store (`store._serializeAll()`) into an inline `<script type="application/json" data-puzzle-static-data>` island, swaps the `/app.js` tag for the page's module, and drops `staging/app.js`. `beforeMount` runs only at build time.

The static browser kernel ([[FILE-STATIC-MOUNT]], `mountStatic`) wires the same build-time ctx (Store + FormatterRegistry; `ctx.router` is the same link stub — `url()`/`current` answer, navigation throws, mode forced `'history'` to stay byte-identical with the prerender, D117), rehydrates the data island in replace mode, assembles + preloads the chain via the same `assembleChain`, calls `skipEnter()` on every instance — chain views and the nested components `preloadTakeoverComponents` returns, the latter only inside the `data-puzzle-static` guard so a `prerender: false` page keeps its ordinary nested enters — then `replaceChildren()` + mounts the tree over the prerendered markup — flash-free because it re-renders identically from the same data. On a marked page the prerendered nodes are snapshotted first and restored — with the failed root destroyed — when the mount rejects ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]); `playIn()` stays outside the mount try (a rejected enter hook never tears down a mounted component) and an unmarked page keeps the original mount path byte-for-byte. `prerender: false` writes an empty-target shell (no marker) that still ships a data island + entry module and renders fully client-side (a client-rendered island). `models` load from `app/models/index.js` and `formatters` from `app/formatters.js` when present; formatters registered only in the app.js config warn (build-time only, missing client-side).
