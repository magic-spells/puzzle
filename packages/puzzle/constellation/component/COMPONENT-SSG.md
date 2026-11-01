---
name: Static generation runtime
status: verified
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-PRERENDER
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D179-STATIC-PATHS
  - FILE-SSG-RUNTIME
  - FILE-SSG-SERIALIZER
  - FILE-SSG-ASSEMBLE
  - FILE-STATIC-MOUNT
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
verified_at: '2026-11-01T19:25:13.521Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Static generation runtime

Puzzle prerenders routes at build time in two output modes — `output: 'hybrid'` and `output: 'static'` ([[DOC-SPEC-BUILD]] §36) — sharing one orchestrator (`ssg/index.js`), one chain assembler (`ssg/assemble.js`) and one serializer (`ssg/serialize.js`). Neither is SSR or hydration (D1). `puzzle dev` and a plain SPA build do not use it. The ordered build and load steps are [[FLOW-PRERENDER]]; the Go side is [[FILE-BUILD-PRERENDER]] and [[FILE-BUILD-PRERENDER-PAGES]].

## Shared prerender core

`@magic-spells/puzzle/ssg`: `prerender()` touches no DOM or filesystem; `prerenderToDir()` writes output for the Go build's generated Node entry. The orchestrator builds the Store, Router and function registry, calls `beforeMount` with one `{ store, config }` facade (receiver and argument; plus `locale` under translations), enumerates route chains, and `assembleChain` preloads each chain (`created()` + awaited `data()`, `this.route` set, no `mounted()` or animations) into the same nested keyed vnode tree the router builds. The snapshot has the seven-key route shape (static pathname, empty frozen query, `''` hash). Page contexts carry `ctx.idle` resolving `true` (nothing to wait on).

- **Pass structure:** `planRoutes` makes each route's skip/reuse/shell/render decision once; each locale pass then runs `entriesFor` (one entry for a fixed route, one per listed value for a `staticPaths` route, [[DECISION-D179-STATIC-PATHS]]) → `renderEntry`. `pageFile(routePath)` is the one route-path → file mapping, and the identity a generated page is compared to fixed pages by (static: the fixed page keeps its file, warned). A generated page carries `pattern` (its route as authored) on `Page`/`WrittenPage`, and `params` on its route JSON.
- **Output paths:** `<path>/index.html`; a top-level catch-all writes `404.html`; a `:param` route without `staticPaths` is skipped with a warning naming the field (reason `'empty staticPaths'` when its list is empty); `prerender: false` writes the plain shell. Hybrid also skips a page an earlier route matches first in the live router (reason `shadowed`, via `findShadowedPaths`), so takeover never renders a different view. Guards never run at build time: hybrid warns per rendered guarded page, static warns once.
- **Serializer** mirrors ViewManager: escaped text and attributes, controlled initial state as attributes, wrapperless components, shared `expandSlots`, SVG seeds verbatim, framework attrs/events/keys/refs omitted, placeholders and Portals → nothing, `@@name` → literal `@name`, `#html` → its markup. RAWTEXT ([[DECISION-D113-SSG-RAWTEXT-RULE]]): `<script>`/`<style>` text is never entity-escaped; JSON scripts write `<` as its JSON unicode escape (`escapeScriptJson`, shared by the data islands); other script/style content fails the build on `</script`/`</style` or the `<!--` + `<script` pair.
- **`<Component>` selection (D180):** both modes traverse the selected constructor's ordinary vnode with the normal props/data/slot machinery and serialize the range's children with no wrapper (nothing for a nullish selection). There is no registry or runtime module lookup; selection ranges recurse through the same assembly and serialization walkers as ordinary children.
- **Head** ([[DECISION-D84-HEAD-MANAGEMENT]]): fields resolve leaf → root through the `head.js` resolver the router shares; a `{ t: 'key' }` title/description resolves through the pass's i18n service (`headText`). `MANAGED_TAGS` (`headTags.js`) is used only here. Injection replaces, removes and inserts `data-puzzle-head` tags by escaped string surgery confined to the shell's head region.
- **Shell plan** ([[DECISION-D151-SHELL-HEAD-OWNERSHIP]]): the shell is read once and compiled into build-constant offsets (head span, `<title>`, marker spans, target, `</body>`); each page is one ordered splice. `bodyCloseIndex` is the **last** `</body>` match, so a `</body>` in a comment or script string can't swallow the islands. Rendered `<title>`/`data-puzzle-head` markup is view output and never rewritten.
- **Per-build work stays out of the page loop:** hybrid pages share one unstarted memory Router; the data island's escape is memoized on the exact payload string; writes claim every output path first (hybrid last-wins, static first-wins), then inject pages lazily into a bounded worker pool (`WRITE_CONCURRENCY`). The first error fails the build; summary order follows the page list.
- **Translations** (D175): `loadBuildI18n` reads the staged default-locale table and builds one service per pass (which also calls `setFormatLocale`), sets `ctx.i18n` and `t`, adds a `data-puzzle-locale` JSON island before `</body>` on every page, and `withHtmlLang` rewrites `<html lang>` and `dir`. Apps without i18n emit byte-identical HTML.
- **Locale prefix routing** ([[DECISION-D177-LOCALE-URL-PREFIXES]]): `BuildI18n.tables` holds every locale's table; a missing one fails the build. The pass runs locale by locale, default first, creating each locale's service right before its pages (the format locale is module state) and restoring it after. Page-module slugs are per route path, shared by every locale. `pageDressing` gives each page its folder (`dist/<locale>/…`), its own island, its `hreflang` alternates (a managed set; none on `*` or `prerender: false` pages) and, on default-locale pages, the first-visit redirect from `ssg/redirect.js` (one function's source text, inlined; the build fails if it contains `</script` or `<!--`; omitted under `detect: false`). A generated page's alternates and redirect name only the locales whose `staticPaths` lists contain it; `redirectFor` caches one script per distinct locale set. A root-relative or same-origin canonical is localized per locale. `site` (a prerender option) makes alternates absolute (warned once when absent). `WrittenPage.locale` tags each page.
- **Sitemap:** with `site`, `prerenderToDir` writes `outDir/sitemap.xml` — every prerendered page except 404 and `prerender: false`, with `xhtml:link` alternates under prefix routing — unless the public folder already ships one (warned).
- **Generated entries force-exit** in the summary write's callback (`process.stdout.write(…, () => process.exit(0))`): SSG runs `created()` but never `destroyed()`, so a timer from `created()` would pin the subprocess until the 120 s timeout. The callback matters — a bare `exit()` after a pipe write truncates the payload.

## `ctx.router` parity

A prerendered `href` (`link(path)` reads `router.url`) must match the client's. Every path calls the single `encodeURL(path, mode, base)` (and `normalizeBase`) from `router/router.js`; under prefix routing the base comes from `localeBase` and the option from `linkLocale`, from the same module. `tests/router-locale-prefix.test.js` pins the encoders per locale.

- **Static:** `makeRouterStub` over the page snapshot — navigation methods throw, `current` is the snapshot, `url()` always uses path encoding (static pages are path-shaped files with no router, so a hash href would be dead; [[DECISION-D81-STATIC-PAGES-MODE]]); a configured `routerMode` warns; `routerBase` applies. Under prefix routing `localizeRouterStub` swaps in a locale-aware `url(path, options)`. It stays separate from `makeRouterStub` because esbuild keeps unused destructured parameters, so apps without routing ship the one-argument stub. The browser kernel calls the same function.
- **Hybrid:** the real unstarted memory Router (takeover needs its compiled table, and `current` reads private fields so it can't be wrapped), with `url()` shadowed to path encoding over the real `routerBase` and `current` shadowed per page ([[DECISION-D142-HYBRID-ROUTE-SNAPSHOT]]); under prefix routing the `url` shadow is re-set per locale. `prerender()` throws for hybrid with a `routerMode`.

## Hybrid mode (D67)

Each page is prerendered markup plus the shared `/app.js`, built with `__PUZZLE_TAKEOVER__=true` ([[DECISION-D130-TAKEOVER-BUILD-DEFINE]]) — not interchangeable with a plain build's bundle. The target gets `data-puzzle-ssg`; [[COMPONENT-ROUTER]] takes over at navigation zero, replaces the children in its commit window and `skipEnter()`s the chain plus the nested instances `preloadTakeoverComponents` returns; afterwards it is an ordinary SPA. Hybrid transfers **no** D161 read state: takeover re-runs `data()` as a fresh browser session.

## Static mode (D81)

A true static site: no router, no `app.js`, plain `<a>` navigation. The build emits one module per page, `dist/_puzzle/<slug>.js` (`/` → `index`, `*` → `404`, else `/` → `--`, collisions suffixed), importing `mountStatic` plus exactly that page's classes via the codegen `__pzlModule` stamp; shared code splits into `dist/_puzzle/chunks/`. `injectStaticShell` stamps `data-puzzle-static`, writes the store snapshot (`store._serializeAll()`) as a `data-puzzle-static-data` island, adds a `data-puzzle-static-read` island (`{ v: 1, complete, absent }`) only when the page settled reads through the adapter, and swaps the app script for the page module (prefixed by `routerBase`). The app script may use a bare, `./`, `/` or normalized `routerBase` prefix with a query or fragment; public vendor scripts stay in the shell. `beforeMount` and tracked-query faults run at build time: the API must be reachable from Node, and a non-404 fault fails the build naming the route.

- **Generated pages** ([[DECISION-D179-STATIC-PATHS]]): every page of a `staticPaths` route shares one module, slugged from its `pattern` with `:` → `_` (`blog--_slug`), and carries a `data-puzzle-static-route` JSON island (its path and params) that the shared entry merges into the pattern-shaped route JSON. Fixed-route modules are unaffected.
- **`only` subset** ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]): the dev loop passes a route subset on `argv[4]` (not in the entry source — dev keeps one esbuild context over those bytes). Every route is still enumerated, claims its path and slug (so slugs never renumber) and appears in `written` as `reused`, but gets no context. An empty subset renders nothing and skips the zero-page `beforeMount` fail-fast. A `staticPaths` route outside the subset still re-runs its list (and so `beforeMount`) to enumerate its reused pages.
- Static reports `modules` for skipped routes too (chain roots for invalidation); a missing `__pzlModule` stamp there is dropped, not raised.
- **Browser kernel** ([[FILE-STATIC-MOUNT]], `mountStatic`): the same ctx (Store, functions, the router stub, `idle`); rehydrates the data island in replace mode, then the read island via `capabilities.js` `hydrateReadState` (records first; never imports the adapter module, D157); assembles and preloads via `assembleChain`; `skipEnter()`s everything (nested components only on a marked page); `replaceChildren()` + mount. On a marked page the prerendered nodes are snapshotted and restored if the mount rejects ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]); `playIn()` stays outside that try. A `prerender: false` page renders fully client-side.
- **Locale switch on a static page:** without prefix routing, `setLocale` re-assembles and re-mounts the page's chain in place (nested components preloaded, enters skipped, last switch wins); a mount that throws restores the old DOM and `setLocale` rejects. Under prefix routing `setLocale` loads the other locale's page. A client-rendered page, or a viewer whose locale differs from the page's island, gets its `{ t }` title synced.
- `models` load from `app/models/index.js`, functions from `app/formatters.js`; functions registered only in the `app.js` config warn. A configured `storage` warns and is ignored (a live Storage can't cross build → client).
- **Adapter binding by identity** ([[DECISION-D157-ADAPTER-SUBPATH]]): the summary carries `adapterConfigured` and `adapterModuleMatches` (namespace-import `app/adapter.js` and compare to `config.adapter`), and each page entry picks one of three tiers: the bare subpath capability, the conventional module, or — for an inline `adapter.defaults(...)` — importing the app entry under `__PUZZLE_CAPTURE__` (makes `PuzzleApp.mount()` a no-op; the build prints a page-weight advisory). Every tier puts the adapter, and so the settle loop, in the page graph.
