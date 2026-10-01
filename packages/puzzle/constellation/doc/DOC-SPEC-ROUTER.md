---
name: SPEC — routing, navigation, and commit semantics
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DECISION-D175-TRANSLATIONS
verified_at: '2026-08-24T18:51:28.273Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
code_refs:
  - client-runtime/router/router.js
  - client-runtime/router/modes.js
  - client-runtime/router/routePath.js
---

The contract for routing: the router surface, scroll, hash/memory modes and base path, the `this.route` snapshot, transitions, atomic location commit, query snapshot plus `replace()`, route head, guards, focus management, lazy route views, and the locale rebuild. See [[DOC-SPEC]] for the section index; the user guide is [[DOC-ROUTER]].

## 9. Router

```js
// routes.js
export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home' } },
  { path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
];
```

- Path routing (pathname + HTML5 history) is the default; hash and memory modes are opt-in imports (§15).
- `:param` segments arrive as `params` in `data(params, props)`. Param values are strings.
- `layout` wraps the view, which renders at the layout's `<Slot/>`. `meta.title` sets `document.title` (§45).
- Navigation: `this.ctx.router.push('/user/123')`. **`router.go(n)` / `back()` / `forward()`** work in every mode (path/hash delegate to `history.go(n)`; memory moves its stack index); out-of-range `n` is a silent no-op.
- **`router.url(path)`** (D79): path in, mode-encoded href out — `base + path` (path), `'#' + base + path` (hash), unchanged (memory). A string not starting with `/` passes through (external URLs, `mailto:`, bare `#anchor`); a non-string throws. Query and `#anchor` suffixes ride along. Templates reach it as the `link` function — `href="{ link('/user/' + id) }"`.
- **Commit order:** a push updates the URL only after the new chain's `data()` resolves — URL, DOM and title change atomically (§30); a failed or superseded navigation changes nothing. Rapid navigations cancel (last wins).
- **404:** an optional catch-all `path: '*'` is always matched last; without one the router warns and stays on the current view.
- **Path shape (D126):** a top-level `path` must be `'*'` or start with `/` (empty/relative throws at construction). A dynamic segment is a complete `:name` segment only — `:` or `*` inside an otherwise static segment is literal (`/releases/v1:beta`, `/files/*`). `*` is a catch-all only as a bare top-level path. `client-runtime/router/routePath.js` owns this judgement and the prerenderer uses the same function.
- **Declaration order is load-bearing:** first match wins, so a static route after a dynamic one that matches it is unreachable (`/user/:id` before `/user/new`). The router warns in development; the hybrid prerenderer skips that page as `shadowed`; static output is unaffected.
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
- **Params merge down the chain:** the URL is matched once and every level's `data(params)` gets the full merged object.
- **Chain reuse:** the shared prefix is kept; reused ancestors' `data()` re-runs with merged params and is **awaited before the URL commits** (D19); only divergent levels rebuild. The **topmost swapped view** animates; everything below rides along.
- Inside any routed `data()`, `this.route` describes the navigation being gated (§19).

Full state machine: [[DOC-VIEW-LIFECYCLE]].

**Locale rebuild (D175; template side §66).** With `i18n` configured, `mount()` awaits the locale table after `beforeMount` and before the HMR restore and `router.start()`, so navigation #0 — guards, `data()`, commit — never runs without its strings; if neither the chosen locale nor the default loads, the mount aborts like a rejected `beforeMount`. `ctx.i18n.setLocale(tag)` loads the table and then triggers a **same-location rebuild**: the committed path re-runs with keep = 0 (every routed view and the layout constructed fresh, `data()` re-run, one atomic commit) in replace mode — no history entry, no scroll change (`scrollBehavior` not consulted), no focus move or announcement, every enter and the outgoing exit animation skipped. Store records survive; `setData` state does not. A navigation still loading lands first and the rebuild then runs wherever the app ended up (`setLocale` does not wait for that, since the switch may come from inside that navigation's own guard or `data()`). The committed chain stays invalidated if the rebuild is superseded, so the next navigation rebuilds every level too. The returned promise rejects when the rebuild failed and the old chain is still on screen. Nested components inside rebuilt views mount fresh and may play their own enters. Implemented as `router.__failedView(null, true)` with a module-private `REBUILD` marker, all behind `__PUZZLE_HAS_I18N__`. Locale files resolve under `routerBase` in path mode, and next to the entry module (the manifest's `base`, falling back to `document.baseURI`) in hash and memory mode, so a script embed on another site still finds them; memory mode leaves `<html lang>` alone. Route `meta.title` stays a static string — there are no translated titles.

## 14. Router scroll behavior

The router owns **window scroll** across navigations (D33, D41).

**Default:** push/link → top (`scrollTo(0, 0)`); back/forward → restore that entry's saved position, else top; navigation #0 never touches scroll; a failed or superseded navigation never touches scroll.

**Timing:** applied synchronously inside the commit — after the incoming view is in the DOM, before paint, after the old view's `out` (§12).

**Mechanics:**
- `history.scrollRestoration = 'manual'` between `start()` and `stop()` (restored on stop), because browser restoration fires on popstate before the swap.
- Positions are keyed by a per-entry `__puzzleScrollKey` in `history.state`: `pushState` carries a fresh key; foreign/initial entries get one lazily via `replaceState` (other state preserved).
- On popstate the outgoing position is saved under the router's in-memory current key before adopting the target's key (`history.state` has already moved).
- The outgoing position is captured when the navigation starts: by commit time the old view is gone and the browser has clamped `scrollY`. It is saved at commit (swap) time, so scrolling during the `out` animation is remembered.
- The map mirrors to one `sessionStorage` key (`__puzzleScroll`) and `start()` hydrates it, so reload + back/forward restores. Capped at **50 entries**, oldest evicted; all storage access is fail-soft.

**`scrollBehavior` config:** omitted → default; **`false`** → never touch scroll (or storage) — for shells that scroll an inner panel; **`(to, from, savedPosition) => {x, y} | null`** → custom, where `to`/`from` are frozen snapshots (§19/§44; `from` null on navigation #0) and `savedPosition` is non-null only on a pop. Falsy return leaves scroll alone; a throw is logged and treated as falsy.

**Anchors:** a `#anchor` suffix refines the default push landing — `push('/docs#faq')` or a link carrying the fragment lands at `getElementById(decodeURIComponent('faq'))`, else top (including a skeleton view whose target hasn't rendered; never re-applied). On a pop the saved position wins; a custom function wins over everything (the anchor rides in `to.path`). In hash mode the anchor rides inside the fragment: `#/docs#faq`.

Not supported: an `{ el }` return shape, scroll retention in non-window containers, smooth-scroll options.

## 15. Router modes: hash and memory

**`routerMode` is an imported factory, not a string (D159).** Path routing is inline and the default; the others are opt-in imports, so unused modes never bundle:

```js
import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes';
new PuzzleApp({ routerMode: hashRouter() });
new PuzzleApp({ routerMode: memoryRouter({ initialPath: '/about' }) });
```

A mode string (`'hash'`, `'memory'`, `'history'`) is a constructor throw naming the import. Validation is by shape: a value without a callable `create` throws, and so does one whose `create()` yields nothing (an unbuilt mode would silently read as path routing). `RouterMode` is branded in the types, so only a factory's return type-checks. Duck-typed modes are not an extension point. Each Router builds its own mode instance, so a descriptor may be reused.

**The app-facing API is path-shaped and mode-agnostic** — routes, `push('/user/123')`, `current.path`, params, `meta.title` are identical; no `#` appears in app code. Hrefs stay portable through `link()` (§9).

**Hash mode (D34)** — the deployment story for static hosts without a history fallback (GitHub Pages, S3, `file://`). Three seams change:
- **Reading:** parse `location.hash` — `''`/`'#'` → `/`; `#/...` → that path (an in-fragment `?query` rides along); any other fragment is not a route.
- **Writing:** `pushState` with `'#' + path` (the scroll key still rides `history.state`); the pathname never changes.
- **Interception:** `<a href="#/about">` is routed via `push`; bare `#faq` stays a native anchor; a same-origin link with a different pathname falls through (navigation away); a full URL on the same pathname with a `#/...` fragment is intercepted. A plain `/x` href in hash mode is deliberately **not** claimed — that is the escape hatch, and why path-shaped links go through `link()`.

**Listening is popstate-only in every mode** (never `hashchange`). A pop to a non-route fragment routes `/` on initial load but is **ignored** afterwards. Path mode reaches the same outcome for a pop that differs from the committed path **only in its fragment** (`/docs` ⇄ `/docs#faq`): it is settled in place — `current.path`/`current.hash` update, saved scroll restores only if a position exists, and nothing loads, refreshes, moves focus or announces.

**In-page-anchor limitation (inherent to hash routing):** clicking a bare `#faq` replaces the whole fragment; the view survives and Back returns to the route, but the URL no longer names it. Hash-mode apps should avoid bare anchors.

**Memory mode (D42)** — for tests and embeds that must not touch the host URL. An in-memory stack replaces `history`: `push()` truncates forward entries and appends; `go`/`back`/`forward` move the index and run as a pop. The full pipeline (atomic commit, cancellation, transitions, nested chains) runs unchanged. Deliberate differences:
- No document-level side effects: no popstate listener, no `document.title`, no `<html lang>`.
- Scroll management and `routerBase` are accepted but inert.
- The click interceptor stays active (document-global — same-origin path links in a host page are intercepted too).
- `memoryRouter({ initialPath })` names the first route (default `'/'`); there is no app-config spelling. `createTestApp` (§53) takes its own `routerInitialPath` and hands it to the mode it forces.

Not supported: mount-scoped link interception for embeds.

## 19. Route snapshot in `data()`: `this.route`

The route source that is correct **inside** a navigation (D47). Inside a gated `data()` run `window.location` and `router.current` still describe the old route, so an active-nav highlight derived from them lands one navigation behind.

```js
data(params, props) {
  const name = this.route.route.name; // the navigation THIS data() run is gating
  return { isProfile: name === 'account-profile', isTrips: name === 'account-trips' };
}
```

- `this.route` is `{ path, pathname, query, hash, route, params, chain }` — the `router.current` shape (`route` = leaf node, `chain` = root→leaf nodes, parsed parts per §44) — describing the navigation that delivered this view's params. The two agree again at commit.
- The router threads one **frozen** snapshot per navigation through its guards (§48), every gated `preload()`/`refresh()` (fresh views and reused ancestors), and the reused layout's post-commit refresh — the same channel as `params`, in every mode, on push, pop and navigation #0.
- A store-change re-run keeps the stored snapshot.
- **A mounted view's `this.route` mirrors the last committed navigation, fragment included.** An in-page anchor move is not a navigation (§15) and delivers no snapshot. The live fragment is `router.current.hash`; pair it with a `hashchange`/`popstate` listener, since an anchor move triggers no re-render.
- `this.route` is `null` for components the router does not manage; pass route state down as props.
- **Failure semantics follow params:** a failed or superseded navigation changes neither the URL, `router.current`, nor a reused ancestor's params or snapshot; an ancestor's gated run commits only with the navigation (D146). **A failed pop repairs the URL:** the browser moved the address bar before the router ran, so a pre-commit failure (guard block, no-op guard redirect, `lazy()` rejection, constructor throw, `data()` rejection) restores the committed URL with `replaceState` — no history entry added. The repair belongs to the failing navigation: one superseded by a newer navigation restores nothing. A guard redirect continues the pop under the redirect target and repairs the same way while its redirect chain still owns the location (tested with its own chain token **and** committed-state identity, since re-entering the pipeline bumps the router token).
- A reused root layout's post-commit refresh runs **after** the state commit, so `router.current` read there is never stale.

**Idiom:** compare route **names** (`this.route.route.name`, or `this.route.chain[0].name` for the section), not `path`, which is the raw pushed path with any query and anchor.

Rejected: a reactive `router.current` (reading it in `data()` would subscribe and re-run post-commit — a double run and new store machinery); `router.isActive(path)` (sugar over `this.route`, no demand).

## 23. Router base path

`routerBase: '/myapp'` serves the app under a sub-path (D51).

- **App code stays base-free.** Routes, `push('/user/1')`, `router.current`, params and `this.route` never see the base. Reads strip it after the mode's raw read; writes prefix it before the mode's encoding.
- **Path mode:** URL `/myapp/user/1`. The interceptor claims only same-origin URLs under the base (stripped on push); others navigate away. Loaded outside the base: warn once, pathname passes through un-stripped (usually the catch-all).
- **Hash mode:** the base rides in-fragment — `#/myapp/user/1`, composing with anchors (`#/myapp/docs#faq`). With a base, only `#<base>` (→ `/`) and `#<base>/...` are routes.
- **Memory mode:** accepted, inert.
- **Hrefs are real URLs and carry the base** (via `link()`); `push()` paths never do.
- **Normalization:** leading `/` ensured, trailing `/` trimmed, `''`/`'/'` → no base. A base containing `#` or `?` throws at construction.

## 26. Overlapping route transitions

Opt-in concurrent transitions — old `out` and new `in` play together (D56). **Sequential is the default.**

- **Config:** `transitionMode: 'sequential' | 'overlap'` on the PuzzleApp config; also per route and per view (§33). An unknown app-level value throws.
- **Positioning (no wrapper element).** At out-start the router pins the outgoing animator's root in place with inline `position: fixed` at its measured `getBoundingClientRect()`, `margin: 0`, `pointer-events: none`, and mounts the incoming chain in the same synchronous block.
- **Sequencing.** The out is started but **not awaited**: the location commit + mount proceed immediately (data was already awaited, D19). The leaver is destroyed when its `out` settles; enter stays fire-and-forget.
- **Hooks:** `viewWillHide()` fires at out-start; the new view's `mounted()`/`viewWillShow()` fire while the old one fades; the relative order of `viewDidHide()`/`viewDidShow()` is unspecified.
- **Interruption is instant:** a navigation mid-overlap tears the leaver down synchronously — at most two route elements coexist.
- Unchanged: navigation #0, params-only navigations, memory mode, reduced motion (zeroed durations), failure recovery (a doomed navigation never pins).
- **Constraints:** ancestors of the mount container must not carry `transform`/`filter`/`contain` (they re-root the `fixed` pin); document height snaps at commit; combining with a morph handler is best-effort — pick one mechanism per app.

## 30. Atomic location commit

The location side effects — `pushState`/`replaceState`, `document.title`, the memory stack/index, and the outgoing scroll save — commit **inside the swap's synchronous commit window, immediately before the incoming mount** (D61). URL, title, DOM and router state move together.

- **Sequential:** the commit runs after the outgoing `out` (and any morph-leave) settles and the navigation-token checks pass. A push superseded or failed during the out phase commits nothing — no phantom history entry.
- **Overlap (§26):** the out is not awaited, so commit + mount are immediate.
- **Params-only:** no animation; location commits immediately before the state commit.
- **Pops:** the browser already moved the URL; the commit contributes title (+ memory index). A pre-commit failure restores the URL (§19).
- The D19 data gate is unchanged; the §16 skeleton exemption bypasses only the data gate, not the transition.
- **Out of scope:** an exception after the location commit (a mount throw) can leave the URL ahead of the view; there is no rollback (rejected as racy). The failed position is handled by §60.

## 33. Per-route / per-view transition mode

`transitionMode` resolves per navigation, most specific first (D65):

1. A `transitionMode` field on a route or child route (sibling of `layout`/`meta`, not inside `meta`), resolved nearest-defined **leaf → root** like `meta.title`, so a parent sets it for its children.
2. A `transitionMode` class field on the incoming animator's view or layout (colocated with `animations`).
3. The app-level option (§26).

- **Destination-only:** for A→B only B's configuration is consulted; B→A resolves independently. A transition spans two instances with no shared owner, so letting either side win would be one view controlling another's animation. Only a routed view or layout is ever consulted (D30's one-animator rule); nested components are `skipEnter()`'d during a route swap.
- **Validation:** an unknown route-level value throws at construction; an unknown view/layout value warns once per class and falls through to the next tier.
- Only *which* mode is selected changes; §26/§30 behavior is unchanged.

## 44. Router query snapshot + `replace()`

URL-backed transient state — filters, tabs, search, pagination (D83).

**Snapshot fields** (`router.current`, `this.route`): `pathname` — `path` minus query and hash (base-free, trailing slash kept); `query` — a **frozen, null-prototype** object with `URLSearchParams` decoding: single value → string, repeated keys → frozen array in source order, valueless key (`?debug`) → `''`, malformed percent input never throws; `hash` — `''` or the raw `#` fragment. Query values never merge into `params`. Parsing happens once per navigation; a query-only navigation to the same route runs the params-only refresh with the new snapshot.

**`router.replace(path)`** — push's no-history-entry sibling: the same match/load/cancellation/atomic-commit pipeline (§30), the same same-path no-op guard, the same commit-window deferral. At commit: path mode `history.replaceState` (hash mode replaces the fragment entry) keeping the current scroll-entry key; memory mode overwrites `stack[index]`. **Replace never touches scroll by default** (a custom `scrollBehavior` still runs and may override). Static output's router stub throws for it.

## 45. Route head management

Route `meta` carries four **reserved head fields** — `title`, `description`, `canonical`, `socialImage` — resolved by one shared resolver and delivered by two disjoint paths (D84).

- **Resolution:** each field independently, nearest-defined leaf → root; `undefined` inherits, `null` suppresses an inherited value. Values are static strings or `null` — no functions, view data, raw HTML or tag arrays. Custom `meta` keys are untouched. Canonical values are emitted as given (use absolute URLs).
- **Generated tags:** `title` → `<title>` + `og:title` + `twitter:title`; `description` → description + `og:description` + `twitter:description`; `canonical` → `<link rel="canonical">` + `og:url`; `socialImage` → `og:image` + `twitter:image` + `twitter:card=summary_large_image`. Each carries `data-puzzle-head="<field>"`; unmarked shell head elements are never touched.
- **Prerender (the only managed-tag path):** shell injection replaces same-identity managed tags, removes ones that no longer resolve, and inserts the rest before `</head>` — escaped, deterministic string surgery. The edit is confined to the shell's head region (D151); a `<title>` or `data-puzzle-head` in rendered page markup is view output and left byte-identical. With no `</head>` the region ends after the first `</title>`; with neither anchor the inserts warn and are skipped. Prerender results carry a resolved `head` beside `title`.
- **Browser:** syncs **`document.title` only**, at the §30 commit point, and only for a non-null resolved title. Memory mode does no document work. The runtime never syncs managed tags in any mode — `headTags.js` is build-time only — so in an SPA build `description`/`canonical`/`socialImage` are accepted but inert. Crawlers GET each URL fresh, so the baked tags are what they read.
- Define root-route defaults for any field you use so children cannot inherit stale values.

## 48. Route guards: the `guard` route field

Any route node — root, child or catch-all — may declare `guard: ({ to, from, ctx }) => verdict` (D87). The effective chain is every guard on the matched root → leaf path, run **sequentially**, stopping at the first non-allow verdict.

- **Placement:** once per matched navigation — push, replace, pop, params-only, query-only, navigation #0 — after matching and the token bump, before `lazy()` resolution (§62), any construction, and the D19 load gate. A denied navigation commits nothing and has nothing to tear down. A push to the committed path is the §44 same-path no-op and never reaches guards.
- **Arguments:** `to`/`from` are frozen snapshots (`from` null on navigation #0); `ctx` is the app context (`store`, `router`, `formatters`, plus `i18n` when configured).
- **Verdicts:** `undefined`/`true` allows; `false` blocks; a path string redirects through the router **inheriting the denied verb** — a push redirect is a `push()` (Back still returns to the prior page), a pop or navigation-#0 redirect is a `replace()`. The denied URL never enters history; the destination's own guards run. Guards may be async (each awaited; a superseded one abandons silently). A throw is logged and the app stays put.
- **Loop safety:** a redirect to the committed path is the same-path no-op. At most ten guard redirects may run without a commit; the next is treated as a cycle — `console.error`, stay put. A commit resets the counter.
- **Validation:** a present non-function `guard` throws at construction.
- **Guards are UX, not security.** Hybrid prerender warns per rendered page whose chain declares a guard (`prerender: false` is the quiet opt-out); a static build warns once when any route declares one. Warnings only.
- **Idioms:** restore sessions in `beforeMount` (§34, awaited before navigation #0) so guards can be synchronous. Redirect-after-login: return `'/login?redirect=' + encodeURIComponent(to.path)` and have the login view `router.replace()` `this.route.query.redirect`.

## 51. Router focus management + route announcement: `focusBehavior`

After every committed navigation the router moves focus to the incoming view and announces it (D93). `focusBehavior` mirrors `scrollBehavior`: omit for the default, `false` to opt out, a function `(to, from) => Element | falsy` to choose the target.

- Runs in `#commitState`, the post-mount/pre-paint window, **after** the scroll block.
- **`focus({ preventScroll: true })` is mandatory** — a default `focus()` would fight §14's scroll.
- **`tabindex="-1"` is transient** — stamped before focusing, removed on `blur`, so a `<puzzle-view>` root never becomes a permanent tab stop. While stamped, inline `outline: none !important` and `box-shadow: none !important` suppress both focus-ring channels, prior inline values restored on blur (D139). An author-set `tabindex` is never touched, visuals included.
- **One live region**, created at `start()` and removed at `stop()`: `aria-live="polite"`, `aria-atomic="true"`, visually hidden by clip-rect (not `display:none`). It receives `document.title` (already committed by §45) only when non-empty and changed since the last announcement; otherwise the route's `name`, or its `path` when the name would repeat the region's content.
- **Resolution is split:** the gate resolves pre-commit; the target resolves post-mount.
- **Skips:** memory mode entirely; navigation #0 (the gate is nothing committed yet, `from == null` — so a guard redirect before any commit is still #0, while a push superseding a slow #0 focuses normally); failed or superseded navigations; a **params-only replace** (`keep === chain.length`), which is URL-backed state churn — focusing would steal an input's focus each keystroke (D135); the §9 locale rebuild.
- `push`, `replace` and `pop` otherwise all move focus. A custom function that declines focus still announces. Focus is applied **before** the announcement (a polite update right before a focus change is often dropped). A throw is logged and treated as falsy.
- `output: 'static'` pages have no router, so no focus management or live region.

## 62. Lazy route views: `lazy()`

A route's `view` or `layout` may be a **loader** instead of a class, so its code downloads on first navigation (D163). `build.splitting` (§59) decides whether the `import()` becomes its own chunk.

```js
import { lazy } from '@magic-spells/puzzle';
export default [
  { path: '/admin', view: lazy(() => import('./views/Admin.pzl')), layout: DefaultLayout },
];
```

- **`lazy(loader)` returns an opaque branded marker** (frozen, registered in a module-private WeakMap; unforgeable). `loader` is a zero-argument function returning a promise of a module namespace (its `default` is used — missing is an error naming the module) or of a `PuzzleView` subclass.
- **A bare function in a view position is an error**, steering to `lazy()`; every other non-class value gets an error naming it. This check runs after the path/layout/guard/transition checks.
- **Accepted anywhere a view class is:** top-level routes, children, index routes, the catch-all, and the top-level `layout`.
- **Resolution happens after guards, before construction** — a blocked or redirected route never downloads, and layout reuse compares resolved classes.
- **The whole matched chain loads in parallel** through one `Promise.all`.
- **A loader rejection is a failed push:** no instance exists yet, so nothing changes (§30). It reports through `onError` as phase `navigation`; §60's `errorView` and retry apply.
- **Memoization is asymmetric:** fulfillment is cached for the marker's lifetime; **rejection never is** (the slot clears before any consumer sees the failure), so retry reaches the loader again. Concurrent navigations share one in-flight load.
- **No loading UI:** the previous view stays until the new one commits; skeletons (§16) cannot render before their module arrives.
- **Prerender awaits the same markers** in both modes; static pages bundle the resolved class (§36) and have no runtime laziness.
- A route table with no markers allocates nothing extra and adds no microtask; `__PUZZLE_HAS_LAZY__ = false` drops the resolver from the bundle (§54).
