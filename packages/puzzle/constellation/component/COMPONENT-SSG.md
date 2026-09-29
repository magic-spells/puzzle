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
  - FILE-SSG-RUNTIME
  - FILE-SSG-SERIALIZER
  - FILE-SSG-ASSEMBLE
  - FILE-STATIC-MOUNT
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
verified_at: '2026-09-25T10:47:50.423Z'
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
---

# Static generation runtime

Puzzle prerenders routes at build time in two output modes — `output: 'hybrid'` and
`output: 'static'` ([[DOC-SPEC-BUILD]] §36) — sharing one serializer
(`ssg/serialize.js`), one orchestrator (`ssg/index.js`) and one chain assembler
(`ssg/assemble.js`). Neither is SSR or hydration (D1). `puzzle dev` and a plain
`puzzle build` are unaffected.

## Shared prerender core

`@magic-spells/puzzle/ssg`: `prerender()` is DOM/filesystem-free; `prerenderToDir()`
writes output for the Go build's node prerender bundle. The orchestrator builds
Store/Router/Formatter services, calls `beforeMount` with one `{ store, config }` facade
(receiver and argument), enumerates static route chains, and `assembleChain` preloads
each chain (`created()` + awaited `data()`, `this.route` set, no `mounted()` or
animations) into the same nested keyed vnode tree the router's `#navigate` builds. The
route snapshot has the D83 seven-key shape (static pathname, empty frozen query, `''`
hash).

- **Output paths**: `<path>/index.html`; a top-level catch-all writes `404.html`;
  dynamic/splat routes are skipped with warnings; `prerender: false` writes the plain
  shell. Route guards (D87) never run at build time: hybrid warns per rendered page whose
  chain has a guard, static warns once.
- **Serializer** mirrors ViewManager: escaped text/attrs, controlled initial state,
  wrapperless components, shared `expandSlots`, SVG seeds verbatim, framework
  attrs/events/keys/refs omitted, placeholders → nothing, `@@name` → literal `@name`,
  `#html` → its markup. RAWTEXT ([[DECISION-D113-SSG-RAWTEXT-RULE]]): `<script>`/
  `<style>` text is never entity-escaped; JSON scripts write `<` as its JSON unicode
  escape (`escapeScriptJson`, shared by the data islands); other script/style content
  fails the build on `</script`/`</style` or the `<!--`+`<script` pair.
- **Head** ([[DECISION-D84-HEAD-MANAGEMENT]]): fields resolve leaf → root through the
  `head.js` resolver the router shares. `MANAGED_TAGS` (headTags.js) is used ONLY here —
  the browser syncs only `document.title`. Injection replaces/removes/inserts
  `data-puzzle-head` tags by escaped string surgery, confined to the shell's head region.
- **Shell plan** ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]]): the shell is read once and
  compiled into build-constant offsets (head span, `<title>`, marker spans, target,
  `</body>`); each page is one ordered splice. `bodyCloseIndex` is the LAST `</body>`
  match (`BODY_CLOSE_RE` global), so a `</body>` in a comment or script string can't
  swallow the islands. Rendered `<title>`/`data-puzzle-head` markup is view output and
  never rewritten.
- **Per-build work stays out of the page loop**: hybrid pages share ONE unstarted
  memory Router; the data island's escape is memoized on the exact payload string; writes
  claim every output path first (hybrid last-wins, static first-wins), then inject pages
  lazily into a bounded `fs.promises` worker pool. First error fails the build; summary
  order follows the page list.
- **Translations** (D175): `loadBuildI18n` reads the staged default-locale table, builds
  one service per pass (which also calls `setFormatLocale(defaultLocale)`), sets
  `ctx.i18n`/`t`, adds a `data-puzzle-locale` JSON island at `</body>` on every page, and
  `withHtmlLang` rewrites `<html lang>`. Apps without i18n emit byte-identical HTML.
- **Generated entries force-exit** in the summary write's callback
  (`process.stdout.write(…, () => process.exit(0))`): SSG runs `created()` but never
  `destroyed()`, so a timer from `created()` would pin the subprocess until the 120 s
  timeout. The callback is load-bearing — a bare `exit()` after a pipe write truncates
  the payload.

## `ctx.router` parity

A prerendered `href` (`link(path)` reads `router.url`) must match the client's.

- **Static**: `makeRouterStub` over the page snapshot — navigation throws, `current` is
  the snapshot, `url()` is hard-coded to history encoding (static pages are path-shaped
  files with no router, so a hash href would be dead; [[DECISION-D81-STATIC-PAGES-MODE]]);
  a configured `routerMode` warns; `routerBase` applies.
- **Hybrid**: the real unstarted memory Router (the takeover needs its compiled table,
  and `current` reads private fields so it can't be wrapped), with `url()` shadowed to
  history encoding over the real `routerBase` and `current` shadowed per page
  ([[DECISION-D142-HYBRID-ROUTE-SNAPSHOT]]). `prerender()` throws for hybrid + a
  hash/memory `routerMode`.
- All three paths call the single `encodeURL(path, mode, base)` (and `normalizeBase`)
  exported from `router/router.js` — one encoder makes parity structural.

## Hybrid mode (D67)

Each page is prerendered markup plus the shared `/app.js`, built with
`__PUZZLE_TAKEOVER__=true` ([[DECISION-D130-TAKEOVER-BUILD-DEFINE]]) — not
interchangeable with a plain build's bundle. The target gets `data-puzzle-ssg`; the
[[COMPONENT-ROUTER]] takes over at navigation zero, replaces the children in its commit
window and `skipEnter()`s the chain and the nested instances
`preloadTakeoverComponents` returns; afterwards it is an ordinary SPA. Hybrid transfers
NO D161 read state: takeover re-runs `data()` as a fresh browser session.

## Static mode (D81)

A true static site: no router, no `app.js`, plain `<a>` navigation. The build
([[FILE-BUILD-PRERENDER-PAGES]]) emits one module per page, `dist/_puzzle/<slug>.js`
(`/`→`index`, `*`→`404`, else `/`→`--`, collisions suffixed), importing `mountStatic`
plus exactly that page's classes via the codegen `__pzlModule` stamp; shared code splits
into `dist/_puzzle/chunks/`. `injectStaticShell` stamps `data-puzzle-static`, writes the
store snapshot (`store._serializeAll()`) as a `data-puzzle-static-data` island, adds a
`data-puzzle-static-read` island (`{ v: 1, complete, absent }`) only when the page
settled reads through the adapter, and swaps `/app.js` for the page module (base-prefixed
by `routerBase`). `beforeMount` and tracked-query faults run at build time: the API must
be reachable from Node, and a non-404 fault fails the build naming the route.

- **`only` subset** ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]): the dev loop passes a
  route subset on `argv[4]` (not in the source — dev keeps one esbuild context over those
  bytes). Every route is still enumerated and claims its path and slug (so slugs never
  renumber) and appears in `written` (`reused`), but no context is built for it. An empty
  subset renders nothing and skips the zero-page `beforeMount` fail-fast.
- Static reports `modules` for SKIPPED routes too (chain roots for invalidation); a
  missing `__pzlModule` stamp there is dropped, not raised.
- **Browser kernel** ([[FILE-STATIC-MOUNT]], `mountStatic`): same ctx (Store, formatters,
  the link stub); rehydrates the data island in replace mode, then the read island via
  `capabilities.js` `hydrateReadState` (records first; never imports the adapter
  module, D157); assembles + preloads via `assembleChain`; `skipEnter()`s everything
  (nested components only on a marked page); `replaceChildren()` + mount. On a marked
  page the prerendered nodes are snapshotted and restored if the mount rejects
  ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]); `playIn()` stays outside that try.
  A `prerender: false` page renders fully client-side.
- `models` load from `app/models/index.js`, `formatters` from `app/formatters.js`;
  formatters registered only in the app.js config warn. A configured `storage` warns and
  is ignored (a live Storage can't cross build → client).
- **Adapter binding by identity** ([[DECISION-D157-ADAPTER-SUBPATH]]): the summary
  carries `adapterConfigured` and `adapterModuleMatches` (namespace-import
  `app/adapter.js` and compare to `config.adapter`), and each page entry picks one of three
  tiers: the bare subpath capability, the conventional module, or — for an inline
  `adapter.defaults(...)` — importing the app entry under `__PUZZLE_CAPTURE__` (makes
  `PuzzleApp.mount()` a no-op; the build prints a page-weight advisory). Every tier puts
  the adapter, and so the settle loop, in the page graph.
