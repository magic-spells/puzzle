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
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D161-AUTO-FETCHING-FINDS
  - FEATURE-V1-33-SSG
  - FEATURE-V1-47-STATIC-PAGES
  - FILE-SSG-RUNTIME
  - FILE-SSG-SERIALIZER
  - FILE-SSG-ASSEMBLE
  - FILE-STATIC-MOUNT
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
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
  - kind: verified
    text: >-
      Empty-subset contract verified against ssg/index.js: the zero-page beforeMount fallback now
      requires only === null, so only: [] builds no context while a full render with no writable
      page still fails fast.
    sha: e76df0fd873bd4739a754d9861197a9f24074a5f
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: gotcha
    text: >-
      Both generated prerender entries force-exit in the summary write's callback
      (`process.stdout.write(…, () => process.exit(0))`) instead of letting Node's loop drain: SSG
      runs `created()` but never `destroyed()` (SPEC §36), so a timer or socket opened in
      `created()` pins the subprocess until the 120s timeout kills it and fails the build blaming
      `data()`. The callback is load-bearing — a bare `process.exit()` after a pipe write truncates
      the payload and turns the hang into a "missing sentinel" failure.
---

# Static generation runtime

Puzzle prerenders routes to static HTML at build time in **two output modes** — `output: 'hybrid'` and `output: 'static'` — sharing one serializer, one prerender orchestrator, and one chain assembler. Neither introduces an SSR server or a hydration protocol (D1 holds for both). `puzzle dev` and a plain `puzzle build` are unaffected.

D150 raw-block text needs no serializer-only node type: compiled bodies are
ordinary text vnodes. The existing per-parent branch is the parity seam — normal
elements entity-escape text, while script/style use D113 RAWTEXT (including the
JSON-transparent `\u003c` rule). The serializer also decodes a private `@@name`
vnode attribute to the authored literal `@name` instead of dropping it as a
framework event directive.

## Shared prerender core

`@magic-spells/puzzle/ssg` turns PuzzleApp config + compiled ViewNode trees into static HTML. `prerender()` is DOM/filesystem-free; `prerenderToDir()` writes output for the Go build's node-platform prerender bundle. The orchestrator builds Store/Router/Formatter services, calls `beforeMount` with one `{ store, config }` facade (receiver and argument), enumerates static route chains, and — via the shared `assembleChain` (`ssg/assemble.js`) — preloads each chain's layout/views (`created()` + awaited `data()`, `this.route` populated, no `mounted()`/animations) and builds the nested keyed component vnode tree exactly as the router's `#navigate` does — the frozen snapshot carries the D83 seven-key shape (`pathname` = the static path, empty frozen query, `''` hash). Head fields resolve leaf → root per field through the `head.js` resolver the router shares (D84); the `MANAGED_TAGS` table in `headTags.js` is **this pass's alone** — since D111 the browser syncs only `document.title`, so prerender is the one place managed tags are ever built. Pages carry `head` beside the compatibility `title`, and both shell injectors replace same-identity `data-puzzle-head` tags in place, remove suppressed ones, and insert the rest before `</head>` — escaped string surgery, no HTML parser; head-absent callers keep exact pre-D84 behavior. That surgery is confined to the shell's **head region** ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]]): the shell is read once per build, so a compiled plan holds the head span, its `<title>`, every marker span, the empty target element, and `</body>` as build constants, and a page is one ordered splice over those offsets rather than a dozen document-wide rescans of the already-injected page. A `<title>` element or `data-puzzle-head` attribute in RENDERED markup is view output and is never rewritten. The serializer (`ssg/serialize.js`) mirrors ViewManager semantics: escaped text/attrs — except RAWTEXT ([[DECISION-D113-SSG-RAWTEXT-RULE]]): `<script>`/`<style>` text is never entity-escaped; JSON-typed scripts (`application/json` or `+json` suffix) emit with `<` escaped to `\u003c` through the `escapeScriptJson` helper the static data island shares, and other script/style content emits raw with the build failing on `</script`/`</style` or the `<!--`+`<script` double-escape pair — controlled form initial state, inline components without wrappers, shared slot expansion, SVG string seeds verbatim, and framework attrs/events/keys/islands/refs omitted; conditional placeholder vnodes serialize to nothing. Static paths write directory-style `<path>/index.html`; a top-level catch-all writes `404.html`; dynamic parameter/splat routes are skipped with warnings; `prerender: false` writes the plain shell at that path. Route guards (D87) are SPA-runtime-only, so the orchestrator warns — never changes behavior: hybrid warns per rendered page whose chain declares a guard (its markup ships publicly; `prerender: false` routes stay quiet), and a static build warns once when any route declares a guard (no router — guards never run).

### Per-build vs per-page work

The prerender pass is a loop over routes, so anything that is a constant of the
build must be computed outside it ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]] is the
same principle applied to the shell). Three things moved out:

- **The route Router.** Hybrid pages share ONE unstarted memory-mode `Router` —
  the instance `prerenderToDir` already builds to validate the route table and
  the one `prerender` reads compiled leaves from. Building it per page recompiled
  every route matcher O(routes) times for an instance that never navigates and
  whose two page-varying properties are shadowed anyway. `url()` is shadowed once
  (history encoding over `routerBase` — hybrid refuses any other mode); `current`
  is redefined per page.
  Static keeps its per-page `makeRouterStub`, which IS the page's snapshot. Which
  facade a page gets is decided in `createPageContext`; `buildContext` takes the
  router it is handed.
- **The data island's escape.** Memoized on the stringified payload compared for
  exact equality — a docs site seeds identical store content for every route, and
  an exact-match key can never serve a stale island. The store snapshot itself is
  still taken per page.
- **The writes.** Both writers claim every output path first (last-wins on the
  hybrid path, mirroring the sequential writer's overwrite order; the static
  path keeps its first-wins duplicate skip), then a generator injects each
  page's HTML lazily into a bounded `fs.promises` worker pool with a Set of
  already-created directories — at most a pool-width of injected pages is alive
  at once, never a full second copy of the site. Claiming before producing is
  the pool's contract: two workers must never race one path. First error wins
  and fails the build; `written`/summary order comes from the page list, not
  completion order.

### The prerender `ctx.router`

Both modes need a `router` in `ctx` that answers `url()` and `current` exactly
as the browser will, or a prerendered `href` (the `{ path | link }` formatter
reads `router.url`) disagrees with the client's re-render. **Static** mode uses
`makeRouterStub` over the page's route snapshot: every navigation method
throws, `current` is the snapshot, and `url()` is the shared encoder — hard-coded
to HISTORY encoding, with `config.routerMode` never reaching the page at all
([[DECISION-D117-STATIC-OUTPUT-HISTORY-HREFS]], [[DECISION-D159-ROUTER-MODE-FACTORIES]]):
static pages are path-shaped files with no router, so a hash-shaped href is dead;
a configured mode gets a prerender warning, and `routerBase` still applies. **Hybrid**
keeps a real *unstarted memory-mode* `Router` — the SPA takeover needs the
compiled route table, and the instance cannot be wrapped in a delegating facade
because `current` reads private fields. Two instance properties are shadowed on
it ([[DECISION-D142-HYBRID-ROUTE-SNAPSHOT]]): `url()` with history encoding over
the app's real `routerBase` (a memory router returns paths unprefixed, so a
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

The original prerender mode, formerly spelled `output: 'static'` and renamed by D81 (behavior byte-identical). Each page is the prerendered markup **plus** the shared `/app.js` runtime bundle — the same SPA runtime, but since [[DECISION-D130-TAKEOVER-BUILD-DEFINE]] built with `__PUZZLE_TAKEOVER__=true`, so it is no longer byte-identical to a plain `puzzle build` bundle and the two are not interchangeable. Shell injection stamps `data-puzzle-ssg` on the empty `#id` target, injects title/content, and containment-checks every path. The browser [[COMPONENT-ROUTER]] recognizes the `data-puzzle-ssg` marker at navigation zero, replaces the prerendered children in its commit window, removes the marker, and skips the initial enter — for the routed chain AND the preloaded nested components (`preloadTakeoverComponents` returns the nested instances and the router `skipEnter()`s them after its supersede check; before that, nested `animations.in`/`viewWillShow` replayed over markup already on screen) — after which the site is an ordinary SPA (routing, transitions, morph unchanged). Choose hybrid for apps that want prerendered first paint and instant client-side navigation afterward. Hybrid deliberately transfers NO D161 read state: the SPA takeover re-runs `data()` as a fresh browser session, so the build's collection-complete/negative facts are never asserted to a client that will talk to the API itself.

## Static mode (`output: 'static'`, D81)

A **true static site**: no router, no SPA takeover, no history API in the output — navigation is plain `<a>` page loads and `dist/` ships no `app.js`. The build ([[FILE-BUILD-PRERENDER-PAGES]]) generates one per-page ES module `dist/_puzzle/<slug>.js` (slug: `/`→`index`, `*`→`404`, else path `/`→`--`, collisions suffixed) that imports `mountStatic` from `@magic-spells/puzzle/static` plus exactly that page's view/layout/component classes — resolved through the codegen `__pzlModule` stamp on every class. esbuild code-splitting factors shared components + the router-free view-layer runtime into `dist/_puzzle/chunks/`. Shell injection (`injectStaticShell`) stamps `data-puzzle-static` on the target, serializes each page's context store (`store._serializeAll()`) into an inline `<script type="application/json" data-puzzle-static-data>` island — followed, when the page's prerender settled anything through the adapter, by a second `data-puzzle-static-read` island carrying the D161 read-state envelope (`{ v: 1, complete, absent }`, same `escapeScriptJson` pass; omitted entirely for adapter-less or settled-nothing pages, so their HTML is byte-identical to pre-D161) — swaps the `/app.js` tag for the page's module, and drops `staging/app.js`. `beforeMount` runs only at build time, and tracked queries fault at build time through the same settle loop: the API must be reachable from Node, `beforeRequest` runs in the build context, and a non-404 fault failure fails the build naming the route.

`prerenderToDir` takes an optional `only` filter in static mode — the dev loop's route-level invalidation hook ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]). Routes outside it are still enumerated, still consume their output-path claim and their slug, and are still reported in `written` (flagged `reused`), but no context is built for them, so `beforeMount` and `data()` never run on their behalf and no file is produced. An empty subset is the limit case and behaves like one — it renders nothing and builds no context at all, because the zero-page `beforeMount` fail-fast belongs to a full render, where no filter was given. Keeping the page list whole is the correctness argument: slugs, duplicate detection and the warning set are all assigned by walking that list in order, so a page dropped early would renumber every `_puzzle/<slug>.js` after it. Only the writes differ between a subset render and a full one. The filter reaches the generated node entry on `argv[4]` rather than in its source, because the static dev builder holds one persistent esbuild context over exactly those bytes; a one-shot build passes three arguments and renders everything.

Static mode also reports `modules` for SKIPPED routes, which ship no page at all. They are chain roots for the same invalidation ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]): the render-wide walk cuts at chain roots, so a skipped route the walk does not know about is descended THROUGH, and every component it shares with a rendered page reads as render-wide. A skipped route is not held to the `__pzlModule` contract a rendered one is — a missing stamp is dropped, not raised.

The static browser kernel ([[FILE-STATIC-MOUNT]], `mountStatic`) wires the same build-time ctx (Store + FormatterRegistry; `ctx.router` is the same link stub — `url()`/`current` answer, navigation throws, and the href encoding is hard-coded path-shaped so it stays byte-identical with the prerender, [[DECISION-D117-STATIC-OUTPUT-HISTORY-HREFS]]), rehydrates the data island in replace mode, then applies the read island through the `capabilities.js` relay (`hydrateReadState` — records first, so a stale absence whose record rode the data island is dropped; a missing island faults normally, a corrupt one logs and is ignored without losing the records; the kernel never imports the adapter module, preserving the D157 boundary for adapter-less pages), assembles + preloads the chain via the same `assembleChain`, calls `skipEnter()` on every instance — chain views and the nested components `preloadTakeoverComponents` returns, the latter only inside the `data-puzzle-static` guard so a `prerender: false` page keeps its ordinary nested enters — then `replaceChildren()` + mounts the tree over the prerendered markup — flash-free because it re-renders identically from the same data, and without repeating the collection loads and 404s the build already settled. On a marked page the prerendered nodes are snapshotted first and restored — with the failed root destroyed — when the mount rejects ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]); `playIn()` stays outside the mount try (a rejected enter hook never tears down a mounted component) and an unmarked page keeps the original mount path byte-for-byte. `prerender: false` writes an empty-target shell (no marker) that still ships a data island + entry module and renders fully client-side (a client-rendered island); its unresolved browser-side queries fault normally. `models` load from `app/models/index.js` and `formatters` from `app/formatters.js` when present; formatters registered only in the app.js config warn (build-time only, missing client-side). A configured `storage` is ignored with a warning — a live Storage object cannot cross the build→client boundary.

The adapter capability is bound by IDENTITY rather than by file convention ([[DECISION-D157-ADAPTER-SUBPATH]]): `adapter.defaults(...)` holds functions, so nothing but its identity survives the node→Go summary. The summary carries `adapterConfigured` and `adapterModuleMatches` — the latter answered by namespace-importing `app/adapter.js` in the prerender entry and comparing it to `config.adapter`, so the file's mere existence proves nothing — and the build picks one of three bindings per page entry: re-import the bare capability from the subpath, import the conventional module when it IS the configured value, or import the app entry and read `app.config.adapter` when the capability was configured inline. The last is the capture tier: `__PUZZLE_CAPTURE__` (a define true only for the per-page pass) makes `PuzzleApp.mount()` a no-op so importing the SPA entry cannot boot an SPA over the prerendered page, and the build prints an advisory line about the page weight it costs. All three tiers put the adapter in the page graph, which is also what installs the settle loop the kernel's preload path needs.
