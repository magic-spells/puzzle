---
name: SPEC — routing, navigation, and commit semantics
kind: reference
status: verified
connections:
  - DOC-SPEC
  - DOC-ROUTER
  - COMPONENT-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DECISION-D175-TRANSLATIONS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D182-NAVIGATION-RESULT
  - DECISION-D183-ROUTE-VIEWS-AGENT-FIELD
verified_at: '2026-11-01T19:25:13.521Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/router/router.js
  - client-runtime/router/modes.js
  - client-runtime/router/routePath.js
  - client-runtime/router/routeViews.js
  - client-runtime/router/lazy.js
  - client-runtime/head.js
  - client-runtime/headTags.js
---

The contract for routing: the router surface, scroll, hash/memory modes and base path, the `this.route` snapshot, transitions, atomic location commit and navigation results, query snapshot plus `replace()`, route head, guards, focus management, lazy route views, and locale switching. [[DOC-SPEC]] holds the section index; the app-author guide is [[DOC-ROUTER]]; the implementation is [[COMPONENT-ROUTER]].

## 9. Router

```js
// routes.js
export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home' } },
  { path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
];
```

- Path routing (pathname + HTML5 history) is the default; hash and memory modes are opt-in imports (§15).
- `:param` segments arrive as string `params` in `data(params, props)`.
- `layout` wraps the view, which renders at the layout's `<Slot/>`. `meta.title` sets `document.title` (§45).
- Navigation: `this.ctx.router.push('/user/123')`. `router.go(n)` / `back()` / `forward()` work in every mode (path/hash call `history.go(n)`; memory moves its stack index); an out-of-range `n` is a silent no-op.
- **`router.url(path, options?)`** (D79): path in, mode-encoded href out — `base + path` (path), `'#' + base + path` (hash), unchanged (memory). A string not starting with `/` passes through (external URLs, `mailto:`, bare `#anchor`); a non-string throws. Query and `#anchor` suffixes ride along. Templates reach it as the `link` function: `href="{ link('/user/' + id) }"`. Under locale prefix routing (below) the href carries the active locale's prefix; `{ locale: 'es' }` encodes for that configured locale (an unconfigured one throws a `RangeError`) and `{ locale: false }` skips the prefix but keeps `routerBase` (for a file that exists once). Without prefix routing the options are ignored.
- **Commit order:** the URL changes only after the new chain's `data()` resolves — URL, DOM and title change together (§30). A failed or superseded navigation changes nothing. Rapid navigations cancel; the last wins.
- **404:** an optional top-level catch-all `path: '*'` is always matched last. Without one the router warns and stays on the current view (the result is `'not-found'`, §30).
- **Path shape (D126):** a top-level `path` must be `'*'` or start with `/` (empty or relative throws at construction). A dynamic segment is a whole `:name` segment only — `:` or `*` inside a static segment is literal (`/releases/v1:beta`, `/files/*`). `*` is a catch-all only as a bare top-level path. `router/routePath.js` owns this rule and the prerenderer uses the same function.
- **Declaration order matters:** first match wins, so a static route after a dynamic one that matches it is unreachable (`/user/:id` before `/user/new`). The router warns in development; the hybrid prerenderer skips that page as `shadowed` (also a `staticPaths` page an earlier route matches first); static output is unaffected.
- **`staticPaths` is a build-only route field** ([[DECISION-D179-STATIC-PATHS]]): on a leaf `:param` route, an array of params objects, a function returning one, or a model name lists the pages the prerender writes (DOC-SPEC-BUILD §36). On a parent or a route with no `:param` it is a build error. The router never reads it, but the route table ships in SPA and hybrid bundles, so load a heavy list source inside the function.
- **Layout reuse:** consecutive routes sharing a layout class reuse the instance (its `data()` re-runs, only the `<Slot/>` content swaps); a different class remounts.
- **Transitions:** sequential by default — old `out`, swap, new `in` (§12); overlap is opt-in (§26, §33).

**Nested routes (D30):**

```js
export default [
  {
    path: '/settings', name: 'settings', view: SettingsShell, layout: DefaultLayout,
    children: [
      { path: '',        name: 'settings-index',   view: SettingsHome },
      { path: 'profile', name: 'settings-profile', view: ProfileView },
    ],
  },
];
```

- `children` paths are **relative** (`/settings` + `profile`); the parent view renders its matched child at its own `<Slot/>`.
- `layout` is **top-level only**. Constructor throws: `layout` on a child, a child path with a leading `/`, `path: '*'` inside `children`, a duplicate `:param` name within one chain.
- An **index child** `path: ''` matches the parent's bare URL. A parent with children but no index child does **not** match its bare URL — it falls through to the catch-all.
- **Params merge down the chain:** every level's `data(params)` gets the full merged object.
- **Chain reuse:** the shared prefix is kept; reused ancestors' `data()` re-runs with the merged params and is **awaited before the URL commits** (D19); only divergent levels rebuild. The **topmost swapped view** animates; everything below rides along.
- Inside any routed `data()`, `this.route` describes the navigation being loaded (§19).

Full state machine: [[DOC-VIEW-LIFECYCLE]].

**Locale switch ([[DECISION-D175-TRANSLATIONS]]; template side §66).** With `i18n` configured, `mount()` loads the locale table after `beforeMount` and before `router.start()`, so navigation #0 — guards, `data()`, commit — always has its strings. If neither the chosen locale nor the default loads, the mount aborts like a rejected `beforeMount`. Without prefix routing, `ctx.i18n.setLocale(tag)` loads the table and then runs a **same-location rebuild**: the committed path re-runs with every routed view and the layout constructed fresh, one atomic commit, in replace mode — no history entry, no scroll change (`scrollBehavior` not consulted), no focus move or announcement, no enter or exit animations. Store records survive; `setData` state does not. Nested components inside rebuilt views mount fresh and may play their own enters.

- A navigation still loading lands first; the rebuild then runs wherever the app ended up. `setLocale` does not wait for it, since the switch may come from inside that navigation's own guard or `data()`.
- If the rebuild is superseded the committed chain stays invalidated, so the next navigation rebuilds every level.
- The returned promise rejects when the rebuild failed and the old chain is still on screen.
- Locale files resolve under `routerBase` in path mode, and next to the entry module (the manifest's `base`, else `document.baseURI`) in hash and memory mode, so a script embed on another site still finds them. Memory mode leaves `<html lang>` alone.
- A route `meta.title`/`description` may be `{ t: 'key' }` (§45), so the tab title follows the switch.

**Locale prefix routing ([[DECISION-D177-LOCALE-URL-PREFIXES]]).** With `i18n.routing: 'prefix'` (path mode only — `mount()` throws under hash or memory) every non-default locale's pages live under `/<locale>`. The router's path-mode base becomes `routerBase + /<locale>` for reading, writing and link interception; route matching, `push()` paths, `router.current` and `this.route` stay locale-free.

- A route whose first segment equals a non-default locale tag throws at construction. `push('/es/about')` routes as written, lands on the catch-all and warns in development.
- The click interceptor takes a link only when its locale base equals the router's; a link into another locale's pages is a real page load.
- `setLocale(tag)` stores the choice and loads the same page under the other prefix — the in-flight navigation's target when one is running, else the committed URL. The router's base never changes while the app runs.
- First visit: on an unprefixed URL, `mount()` redirects (before navigation #0) to the viewer's locale — the stored choice, else the first `navigator.languages` match — unless that is the default, the referrer is this site, or `i18n.detect: false`. Prerendered pages make the same decision in an inline head script, and `mount()` skips it on them. Config: DOC-SPEC-BUILD §13.
- `ctx.i18n.locales` is the switcher list: `{ locale, label, href, active }[]`.

**Route views and the `agent` field ([[DECISION-D183-ROUTE-VIEWS-AGENT-FIELD]]).** `router.views` is a frozen array with one frozen entry per leaf route, in declaration order, catch-all excluded, built once on first read: `{ path, params, name, meta, title, agent, chain }`.

- `path` is the full pattern (`'/:workspace/tasks/:taskId'`), base- and locale-free; `params` its `:param` names; `name` and `meta` the leaf's own; `title` is `meta.title` resolved leaf → root as in §45 (a string, `{ t }`, or `undefined` — a `null` suppression reads as `undefined`); `chain` the route definitions root → leaf.
- The current page's entry: `router.views.find((v) => v.chain.at(-1) === router.current.route)`.
- `agent` is a top-level route field: `false` hides a route; `{ name, about? }` names and describes it (extra keys pass through). It resolves **nearest-defined leaf → root**: `false` on a parent hides the subtree, a child's own object re-exposes it, and children that set nothing inherit (and share the name of) the parent's object.
- The router, prerender and SSG never act on it; consumers filter `router.views`.
- Development only: the constructor throws on a value that is neither `false` nor an object with a string `name` (and string `about`, if present), on any node including the catch-all; warns once per name declared by two or more different `agent` objects, listing every path that resolves to it; and, once any route declares `agent`, warns once listing the leaves that resolve to `undefined`.

## 14. Router scroll behavior

The router owns **window scroll** across navigations (D33, D41).

**Default:** push/link → top; back/forward → that entry's saved position, else top; navigation #0 never touches scroll; a failed or superseded navigation never touches scroll.

**Timing:** applied synchronously inside the commit — after the incoming view is in the DOM and the old view's `out` (§12) has played, before paint.

**Mechanics:**
- `history.scrollRestoration = 'manual'` between `start()` and `stop()` (restored on stop), because browser restoration fires on popstate before the swap.
- Positions are keyed by a per-entry `__puzzleScrollKey` in `history.state`: `pushState` carries a fresh key; foreign or initial entries get one lazily via `replaceState` (other state preserved).
- The outgoing position is captured when the navigation starts (by commit time the old view is gone and `scrollY` is clamped) and saved at commit, so scrolling during the `out` animation is remembered. On popstate it is saved under the router's in-memory current key, since `history.state` has already moved.
- The map mirrors to one `sessionStorage` key (`__puzzleScroll`), hydrated by `start()`, so reload + back/forward restores. Capped at **50 entries**, oldest evicted; all storage access is fail-soft.

**`scrollBehavior` config:** omitted → default; **`false`** → never touch scroll or storage (for shells that scroll an inner panel); **`(to, from, savedPosition) => {x, y} | null`** → custom, where `to`/`from` are frozen snapshots (§19/§44; `from` null on navigation #0) and `savedPosition` is non-null only on a pop. A falsy return leaves scroll alone; a throw is logged and treated as falsy.

**Anchors:** a `#anchor` suffix refines the push landing — `push('/docs#faq')` or a link with the fragment lands at `getElementById(decodeURIComponent('faq'))`, else top (including a skeleton view whose target has not rendered; never re-applied). On a pop the saved position wins; a custom function wins over everything (the anchor rides in `to.path`). In hash mode the anchor rides inside the fragment: `#/docs#faq`.

Not supported: an `{ el }` return shape, scroll retention in non-window containers, smooth-scroll options.

## 15. Router modes: hash and memory

**`routerMode` is an imported factory, not a string ([[DECISION-D159-ROUTER-MODE-FACTORIES]]).** Path routing is built in and the default; the others are opt-in imports, so unused modes never bundle:

```js
import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';
new PuzzleApp({ routerMode: hashRouter() });
new PuzzleApp({ routerMode: memoryRouter({ initialPath: '/about' }) });
```

A mode string (`'hash'`, `'memory'`, `'history'`) throws, naming the import. A value without a callable `create`, or whose `create()` returns nothing, also throws. `RouterMode` is branded in the types, so only a factory's return type-checks; duck-typed modes are not an extension point. Each Router builds its own mode instance, so a descriptor may be reused.

**The app-facing API is path-shaped in every mode** — routes, `push('/user/123')`, `current.path`, params and `meta.title` are identical; no `#` appears in app code. Hrefs stay portable through `link()` (§9).

**Hash mode (D34)** — for static hosts without a history fallback (GitHub Pages, S3, `file://`). Three seams change:
- **Reading:** `location.hash` — `''`/`'#'` → `/`; `#/...` → that path (an in-fragment `?query` rides along); any other fragment is not a route.
- **Writing:** `pushState` with `'#' + path` (the scroll key still rides `history.state`); the pathname never changes.
- **Interception:** `<a href="#/about">` routes via `push`; bare `#faq` stays a native anchor; a same-origin link with a different pathname navigates away; a full URL on the same pathname with a `#/...` fragment is intercepted. A plain `/x` href is deliberately **not** claimed — that is the escape hatch, and why path-shaped links go through `link()`.

**Listening is popstate-only in every mode** (never `hashchange`). A pop to a non-route fragment routes `/` on initial load and is **ignored** afterwards. In path mode, a pop that differs from the committed path **only in its fragment** (`/docs` ⇄ `/docs#faq`) settles in place: `current.path`/`current.hash` update, a saved scroll position restores if one exists, and nothing loads, refreshes, moves focus or announces.

**In-page anchors in hash mode:** clicking a bare `#faq` replaces the whole fragment; the view survives and Back returns to the route, but the URL no longer names it. Hash-mode apps should avoid bare anchors.

**Memory mode (D42)** — for tests and embeds that must not touch the host URL. An in-memory stack replaces `history`: `push()` truncates forward entries and appends; `go`/`back`/`forward` move the index and run as a pop. The full pipeline (atomic commit, cancellation, transitions, nested chains) runs unchanged. Differences:
- No document-level side effects: no popstate listener, no `document.title`, no `<html lang>`.
- Scroll management and `routerBase` are accepted but inert.
- The click interceptor stays active and document-wide, so same-origin path links in a host page are intercepted too. Mount-scoped interception is not supported.
- `memoryRouter({ initialPath })` names the first route (default `'/'`); there is no app-config spelling. `createTestApp` (§53) takes its own `routerInitialPath` and hands it to the memory mode it forces.

## 19. Route snapshot in `data()`: `this.route`

The route source that is correct **inside** a navigation (D47). During a gated `data()` run, `window.location` and `router.current` still describe the old route, so an active-nav highlight derived from them lags one navigation behind.

```js
data(params, props) {
  const name = this.route.route.name; // the navigation THIS data() run is loading
  return { isProfile: name === 'account-profile', isTrips: name === 'account-trips' };
}
```

- `this.route` is `{ path, pathname, query, hash, route, params, chain }` — the `router.current` shape (`route` = leaf node, `chain` = root → leaf nodes, parsed parts per §44) — for the navigation that delivered this view's params. The two agree again at commit.
- The router passes one **frozen** snapshot per navigation to its guards (§48), every gated `preload()`/`refresh()` (fresh views and reused ancestors), and the reused layout's post-commit refresh — in every mode, on push, pop and navigation #0. A store-change re-run keeps the stored snapshot.
- **A mounted view's `this.route` is the last committed navigation, fragment included.** An in-page anchor move is not a navigation (§15) and delivers no snapshot or re-render; read the live fragment from `router.current.hash` with a `hashchange`/`popstate` listener.
- `this.route` is `null` for components the router does not manage; pass route state down as props.
- **Failures:** a failed or superseded navigation changes neither the URL, `router.current`, nor a reused ancestor's params or snapshot; an ancestor's gated run commits only with the navigation (D146).
- **A failed pop repairs the URL.** The browser moved the address bar before the router ran, so a pre-commit failure (guard block, no-op guard redirect, `lazy()` rejection, constructor throw, `data()` rejection) restores the committed URL with `replaceState` — no history entry added. Only the failing navigation repairs; one already superseded restores nothing. A guard redirect continues the pop under the redirect target and repairs the same way while its redirect chain still owns the location.
- A reused root layout's post-commit refresh runs **after** the state commit, so `router.current` read there is current.

**Idiom:** compare route **names** (`this.route.route.name`, or `this.route.chain[0].name` for the section), not `path`, which is the raw pushed path with any query and anchor.

Rejected: a reactive `router.current` (reading it in `data()` would subscribe and re-run after commit — a double run and new store machinery); `router.isActive(path)` (sugar over `this.route`, no demand).

## 23. Router base path

`routerBase: '/myapp'` serves the app under a sub-path (D51).

- **App code stays base-free.** Routes, `push('/user/1')`, `router.current`, params and `this.route` never see the base. Reads strip it; writes prefix it before the mode's encoding.
- **Path mode:** URL `/myapp/user/1`. The interceptor claims only same-origin URLs under the base; others navigate away. Loaded outside the base: warn once, and the pathname passes through unstripped (usually the catch-all).
- **Hash mode:** the base rides in the fragment — `#/myapp/user/1`, composing with anchors (`#/myapp/docs#faq`). With a base, only `#<base>` (→ `/`) and `#<base>/...` are routes.
- **Memory mode:** accepted, inert.
- **Hrefs are real URLs and carry the base** (via `link()`); `push()` paths never do.
- **Normalization:** leading `/` ensured, trailing `/` trimmed, `''`/`'/'` → no base. A base containing `#` or `?` throws at construction.

## 26. Overlapping route transitions

Opt-in concurrent transitions — old `out` and new `in` play together ([[DECISION-D56-OVERLAP-TRANSITIONS]]). **Sequential is the default.**

- **Config:** `transitionMode: 'sequential' | 'overlap'` on the PuzzleApp config; also per route and per view (§33). An unknown app-level value throws.
- **Positioning (no wrapper element).** At out-start the router pins the outgoing animator's root with inline `position: fixed` at its measured `getBoundingClientRect()`, `margin: 0`, `pointer-events: none`, and mounts the incoming chain in the same synchronous block.
- **Sequencing.** The out is started but **not awaited**: commit and mount proceed at once (data was already awaited, D19). The leaver is destroyed when its `out` settles; the enter is fire-and-forget.
- **Hooks:** `viewWillHide()` fires at out-start; the new view's `mounted()`/`viewWillShow()` fire while the old one fades; the order of `viewDidHide()`/`viewDidShow()` is unspecified.
- **Interruption is instant:** a navigation mid-overlap tears the leaver down synchronously — at most two route elements coexist.
- Unchanged: navigation #0, params-only navigations, memory mode, reduced motion (zeroed durations), failure recovery (a doomed navigation never pins).
- **Constraints:** ancestors of the mount container must not carry `transform`/`filter`/`contain` (they re-root the `fixed` pin); document height snaps at commit; combining with a morph handler is best-effort — pick one mechanism per app.

## 30. Atomic location commit


The location side effects — `pushState`/`replaceState`, `document.title`, the memory stack/index, and the outgoing scroll save — commit **in the swap's synchronous commit window, immediately before the incoming mount** ([[DECISION-D61-ATOMIC-LOCATION-COMMIT]]). URL, title, DOM and router state move together.

- **Sequential:** the commit runs after the outgoing `out` (and any morph-leave) settles and the navigation is still current. A push superseded or failed during the out phase commits nothing — no phantom history entry.
- **Overlap (§26):** the out is not awaited, so commit and mount are immediate.
- **Params-only:** no animation; the location commits immediately before the state commit.
- **Pops:** the browser already moved the URL; the commit contributes the title (and memory index). A pre-commit failure restores the URL (§19).
- The D19 data gate holds; the §16 skeleton exemption bypasses only the data gate, not the transition.
- **Out of scope:** an exception after the location commit (a mount throw) can leave the URL ahead of the view; there is no rollback (rejected as racy). The failed position is handled by §60.

**Navigation result ([[DECISION-D182-NAVIGATION-RESULT]]).** `push(path)` and `replace(path)` resolve a `NavigationResult` and never reject: `{ ok: true, route, catchAll?, redirectedFrom? }` or `{ ok: false, reason, error? }`.

- `ok: true` — committed (the catch-all included); `route` is the committed snapshot. `catchAll: true` is present exactly when the committed leaf is the `path: '*'` route ([[DECISION-D189-AGENT-HOOKS]]), on redirects, reused routes and same-path no-ops too; the snapshot itself carries no flag. A same-path push while that path is in flight returns the in-flight navigation's result.
- **`push()` to the committed path:**

  | Situation | Behaviour |
  | --- | --- |
  | Nothing in flight, chain intact | No-op, `ok` with the current route (`catchAll: true` on the catch-all) |
  | Nothing in flight, chain invalid (failed view) | Rebuild with replace semantics; history unchanged |
  | A push/replace in flight (URL not moved yet) | Supersede it; rebuild with replace semantics; history unchanged |
  | A pop in flight, path or hash mode (browser already moved) | An ordinary push (`pushState`) |
  | A pop in flight, memory mode (index not moved) | Replace semantics |
  | Any row above, called twice in a row | The second call returns the identical promise; `data()` runs once |

  A guard redirect to the committed path stays a no-op (§48). `replace()` to the committed path is a no-op on the first row, joins an in-flight rebuild of that path, and is otherwise an ordinary replace.
- A guard redirect resolves the final navigation's result; when it is `ok`, `redirectedFrom` is the path originally requested (the first one across a chain).
- `'blocked'` — a guard returned `false`. `'superseded'` — a later navigation won. `'not-found'` — no match and no catch-all (still warns). `'error'` plus `error` — anything reported to `onError` (phase `navigation`): a throwing guard, the redirect cycle cap, a lazy load, construction or `data()` failure, or a synchronous throw in the commit window.
- `ok: false` means the navigation did not complete. Every reason except a commit-window throw leaves URL, DOM and `router.current` untouched. A commit-window throw can leave the URL and DOM on the target while `router.current` still names the old route; the next navigation, the same path included, rebuilds every level.
- Only `start()`'s navigation zero (and a guard redirect continuing it) rethrows a commit-window throw, so `mount()` rejects and tears down; a push that supersedes or follows it resolves.
- A push or replace from inside the commit window (a `mounted()` redirect) resolves when the deferred navigation runs; the last-wins slot resolves the entry it displaces, or one `stop()` drops, as `'superseded'`.
- `go()`/`back()`/`forward()` report no result; their promise value is not part of the contract.

## 33. Per-route / per-view transition mode

`transitionMode` resolves per navigation, most specific first (D65):

1. A `transitionMode` field on a route or child route (a sibling of `layout`/`meta`, not inside `meta`), resolved nearest-defined **leaf → root** like `meta.title`, so a parent sets it for its children.
2. A `transitionMode` class field on the incoming animator's view or layout (next to `animations`).
3. The app-level option (§26).

- **Destination-only:** for A→B only B's configuration counts; B→A resolves independently. Letting either side win would let one view control another's animation. Only a routed view or layout is consulted (one animator per transition, D30); nested components are `skipEnter()`'d during a route swap.
- **Validation:** an unknown route-level value throws at construction; an unknown view/layout value warns once per class and falls through to the next tier.
- Only *which* mode is selected changes; §26/§30 behavior is unchanged.

## 44. Router query snapshot + `replace()`

URL-backed transient state — filters, tabs, search, pagination (D83).

**Snapshot fields** (`router.current`, `this.route`): `pathname` — `path` minus query and hash (base-free, trailing slash kept); `query` — a **frozen, null-prototype** object with `URLSearchParams` decoding: single value → string, repeated keys → frozen array in source order, valueless key (`?debug`) → `''`, malformed percent input never throws; `hash` — `''` or the raw `#` fragment. Query values never merge into `params`. Parsing happens once per navigation; a query-only navigation to the same route runs the params-only refresh with the new snapshot.

**`router.replace(path)`** — push's no-history-entry sibling: the same match/load/cancellation/atomic-commit pipeline (§30), the same same-path rules, the same commit-window deferral. At commit: path mode `history.replaceState` (hash mode replaces the fragment entry), keeping the current scroll key; memory mode overwrites `stack[index]`. **Replace never touches scroll by default** (a custom `scrollBehavior` still runs and may override). The static-output router stub throws for it.

## 45. Route head management

Route `meta` carries four **reserved head fields** — `title`, `description`, `canonical`, `socialImage` — resolved by one shared resolver (`head.js`) and delivered two ways ([[DECISION-D84-HEAD-MANAGEMENT]]).

- **Resolution:** each field independently, nearest-defined leaf → root; `undefined` inherits, `null` suppresses an inherited value. Values are static strings or `null` — no functions, view data, raw HTML or tag arrays. `title` and `description` may also be a translation reference `{ t: 'key' }`, resolved through the i18n service (`headText`) at build time and in the browser; without `i18n` it prints nothing and warns in development. Custom `meta` keys are untouched. Canonical values are emitted as given (use absolute URLs); under locale prefix routing a root-relative or same-origin canonical is localized per page.
- **Generated tags:** `title` → `<title>` + `og:title` + `twitter:title`; `description` → description + `og:description` + `twitter:description`; `canonical` → `<link rel="canonical">` + `og:url`; `socialImage` → `og:image` + `twitter:image` + `twitter:card=summary_large_image`. Each carries `data-puzzle-head="<field>"`; unmarked shell head elements are never touched. Under locale prefix routing each prerendered page also gets `<link rel="alternate" hreflang>` per locale plus `x-default`, tagged `data-puzzle-head="alternate"` — a managed set: shell alternates are stripped and the page's own set inserted.
- **Prerender (the only managed-tag path):** shell injection replaces same-identity managed tags, removes ones that no longer resolve, and inserts the rest before `</head>` — escaped, deterministic string surgery, confined to the shell's head region (D151). A `<title>` or `data-puzzle-head` in rendered page markup is view output and left byte-identical. With no `</head>` the region ends after the first `</title>`; with neither anchor the inserts warn and are skipped. Prerender results carry a resolved `head` beside `title`.
- **Browser:** syncs **`document.title` only**, at the §30 commit point, and only for a non-null resolved title (a `{ t }` title is translated first). Memory mode does no document work. The runtime never syncs managed tags — `headTags.js` is build-time only — so in an SPA build `description`/`canonical`/`socialImage` are accepted but inert. Crawlers fetch each URL fresh, so the baked tags are what they read.
- Define root-route defaults for any field you use so children cannot inherit stale values.

## 48. Route guards: the `guard` route field

Any route node — root, child or catch-all — may declare `guard: ({ to, from, ctx }) => verdict` ([[DECISION-D87-ROUTE-GUARDS]]). The effective chain is every guard on the matched root → leaf path, run **sequentially**, stopping at the first verdict that does not allow.

- **Placement:** once per matched navigation — push, replace, pop, params-only, query-only, navigation #0 — after matching, before `lazy()` resolution (§62), any construction, and the D19 load gate. A denied navigation commits nothing and has nothing to tear down. A same-path no-op (§30) never reaches guards.
- **Arguments:** `to`/`from` are frozen snapshots (`from` null on navigation #0); `ctx` is the app context (`store`, `router`, `formatters`, the bound `idle`, plus `i18n` when configured).
- **Verdicts:** `undefined`/`true` allows; `false` blocks; a path string redirects **with the denied verb** — a push redirect is a `push()` (Back still returns to the prior page), a pop or navigation-#0 redirect is a `replace()`. The denied URL never enters history; the destination's own guards run. Guards may be async (each awaited; a superseded one is abandoned silently). A throw is reported to `onError` (phase `navigation`) and the app stays put.
- **Loop safety:** a redirect to the committed path is the same-path no-op. At most ten guard redirects may run without a commit; the next is a cycle — reported to `onError`, stay put. A commit resets the counter.
- **Validation:** a present non-function `guard` throws at construction.
- **Guards are UX, not security.** Hybrid prerender warns per rendered page whose chain declares a guard (`prerender: false` is the quiet opt-out); a static build warns once when any route declares one.
- **Idioms:** restore sessions in `beforeMount` (§34, awaited before navigation #0) so guards can be synchronous. Redirect-after-login: return `'/login?redirect=' + encodeURIComponent(to.path)` and have the login view `router.replace()` to `this.route.query.redirect`.

## 51. Router focus management + route announcement: `focusBehavior`

After every committed navigation the router moves focus to the incoming view and announces it ([[DECISION-D93-ROUTER-FOCUS-MANAGEMENT]]). `focusBehavior` mirrors `scrollBehavior`: omit for the default, `false` to opt out, a function `(to, from) => Element | falsy` to choose the target.

- Runs in the post-mount, pre-paint commit window, **after** scroll.
- **`focus({ preventScroll: true })` always** — a plain `focus()` would fight §14's scroll.
- **`tabindex="-1"` is transient** — stamped before focusing and removed on `blur`, so a `<puzzle-view>` root never becomes a permanent tab stop. While stamped, inline `outline: none !important` and `box-shadow: none !important` hide both focus-ring channels; prior inline values come back on blur (D139). An author-set `tabindex` is never touched, visuals included.
- **One live region**, created at `start()` and removed at `stop()`: `aria-live="polite"`, `aria-atomic="true"`, visually hidden by clip-rect (not `display:none`). It receives `document.title` (already committed, §45) when non-empty and changed since the last announcement; otherwise the route's `name`, or its `path` when the name would repeat the region's content.
- The gate is decided before commit; the target element after mount.
- **Skips:** memory mode; navigation #0 (nothing committed yet — so a guard redirect before any commit is still #0, while a push superseding a slow #0 focuses normally); failed or superseded navigations; a **params-only replace** — URL-backed state churn, where focusing would steal an input's focus on each keystroke (D135); the §9 locale rebuild.
- `push`, `replace` and pop otherwise all move focus. A custom function that declines still announces. Focus comes **before** the announcement (a polite update right before a focus change is often dropped). A throw is logged and treated as falsy.
- `output: 'static'` pages have no router, so no focus management or live region.

## 62. Lazy route views: `lazy()`

A route's `view` or `layout` may be a **loader** instead of a class, so its code downloads on first navigation ([[DECISION-D163-LAZY-ROUTE-VIEWS]]). `build.splitting` (§59) decides whether the `import()` becomes its own chunk.

```js
import { lazy } from '@magic-spells/puzzle';
export default [
  { path: '/admin', view: lazy(() => import('./views/Admin.pzl')), layout: DefaultLayout },
];
```

- **`lazy(loader)` returns an opaque, unforgeable marker.** `loader` is a zero-argument function returning a promise of a module namespace (its `default` is used — a missing one is an error naming the module) or of a `PuzzleView` subclass.
- **A bare function in a view position is an error** steering to `lazy()`; any other non-class value is an error naming it.
- **Accepted anywhere a view class is:** top-level routes, children, index routes, the catch-all, and the top-level `layout`.
- **Resolution happens after guards, before construction** — a blocked or redirected route never downloads, and layout reuse compares resolved classes. The whole matched chain loads in parallel.
- **A loader rejection is a failed navigation:** no instance exists yet, so nothing changes (§30). It reports through `onError` as phase `navigation`; §60's `errorView` and retry apply.
- **Memoization:** a fulfilled load is cached for the marker's lifetime; a **rejection never is**, so retry reaches the loader again. Concurrent navigations share one in-flight load.
- **No loading UI:** the previous view stays until the new one commits; skeletons (§16) cannot render before their module arrives.
- **Prerender awaits the same markers** in both modes; static pages bundle the resolved class (§36) and have no runtime laziness.
- A route table with no markers costs nothing extra; `__PUZZLE_HAS_LAZY__ = false` drops the resolver from the bundle (§54).
