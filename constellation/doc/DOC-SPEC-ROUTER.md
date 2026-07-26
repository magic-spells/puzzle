---
name: SPEC — routing, navigation, and commit semantics
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-ROUTER
verified_at: '2026-07-25T05:53:22.510Z'
verified_sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
notes:
  - kind: verified
    text: >-
      Sections moved byte-for-byte from DOC-SPEC (scripted split, verified by SHA-identical section
      census); §N numbers unchanged. Finally collects the twelve router sections that ship-date
      ordering had scattered.
    sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
---

The frozen v1 contract for routing: the router surface, scroll behavior, hash and base-path modes, the `this.route` snapshot, transitions, atomic location commit, query snapshot plus `replace()`, route head management, route guards, and focus management. See [[DOC-SPEC]] for the section index and the rest of the contract.

## 9. Router (v1 surface)

```js
// routes.js
export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home' } },
  { path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
];
```

- HTML5 history API by default; v1.6 adds opt-in hash mode via `routerMode: 'hash'` — see §15.
- `:param` segments arrive as `params` in the view's `data(params, props)`.
- `layout` wraps the view; the layout template renders it at `<Slot/>`.
- `meta.title` sets `document.title` on navigation.
- Navigation: `this.ctx.router.push('/user/123')`.
- **Programmatic history (v1.11, D42):** `router.go(n)` / `router.back()` / `router.forward()` in **all** modes — history/hash delegate to `history.go(n)` (the popstate path handles the rest); memory mode moves its internal stack index. Out-of-range `n` is a silent no-op (browser semantics).
- **Href encoding (v1.46, D79):** `router.url(path)` — path-shaped route in, mode-encoded href out: `base + path` (history), `'#' + base + path` (hash), unchanged (memory). Strings not starting with `/` pass through untouched (external URLs, `mailto:`, bare `#anchor` — the navigate-away escape hatch); a non-string argument throws. Query strings and `#anchor` suffixes ride along (pure prefixing). Templates reach it as the built-in `link` formatter (§6); it is the render-time inverse of the link interceptor and current-URL parsing.
- **Commit order:** for `push()`, the URL updates only after the new view's `data()` resolves — URL, rendered view, and `document.title` change atomically; a failed or superseded navigation changes nothing. Rapid navigations cancel (last wins).
- **404:** an optional catch-all route `path: '*'` (always matched last) receives unmatched URLs; without one the router warns and stays on the current view.
- **Top-level path shape (D126):** a top-level `path` must be `'*'` or start with `/`; empty and relative paths throw at construction, symmetric with the child leading-`/` throw. A relative top-level path was previously accepted and then unreachable — the click interceptor always pushes a `URL.pathname`, which always begins with `/`.
- **A dynamic segment is a complete `:name` segment, and nothing else (D126).** A `:` or `*` appearing anywhere within an otherwise static segment is literal text: `/releases/v1:beta` and `/files/*` match those exact URLs. `*` is a catch-all only as a bare top-level path — there is no match-everything-under-this-prefix form. `client-runtime/router/routePath.js` owns this judgement and the prerenderer consumes the same function, so the two can no longer disagree about which routes are prerenderable.
- **Declaration order is load-bearing, and shadowing is now reported (D126).** Matching is first-match-wins, so a static route declared after a dynamic route that matches it is unreachable (`/user/:id` before `/user/new`). The Router warns in development only; the hybrid prerenderer skips such a page with reason `shadowed`. True static output (`--static`) is unaffected — it has no router, so the page is correct and is still written.
- **Layout reuse:** consecutive routes sharing the same layout class reuse the layout instance — its `data(params)` re-runs and only the `<Slot/>` content swaps; a different layout class remounts.
- **Transitions (v1.1):** navigation plays the old view's `out` animation, then swaps, then the new view's `in` animation, sequentially — see §12.

**Nested routes (v1.3, D30):**

```js
// routes.js
export default [
  {
    path: '/settings', name: 'settings', view: SettingsShell, layout: DefaultLayout,
    children: [
      { path: '',        name: 'settings-index',   view: SettingsHome },
      { path: 'profile', name: 'settings-profile', view: ProfileView },
      { path: 'billing', name: 'settings-billing', view: BillingView },
    ],
  },
];
```

- A route object may carry `children: [...]` of route objects. Child `path` is **relative** to the parent (`/settings` + `profile` → `/settings/profile`); the parent's view renders its matched child at its own `<Slot/>` (the same injection point layouts use).
- `layout` is a **top-level-route field only** — layouts are root shells; children inherit the chain's layout. `layout` on a child is a **constructor throw** (as are: a child `path` with a leading `/`; `path: '*'` inside `children`; a duplicate `:param` name within one chain).
- An **index child** `path: ''` matches the parent's bare URL. A parent that has `children` but **no** index child does **not** match its own bare URL — it falls through to the catch-all.
- **Params merge down the chain:** the full URL is matched once; **every level's `data(params)` receives the full merged params object**. `meta.title` for the tab resolves nearest-defined, walking leaf → root.
- **Chain reuse:** navigation keeps the shared route-chain prefix (ancestor instances are reused, their `data()` re-run with merged params and **awaited before the URL commits**, per D19); only divergent levels are torn down and rebuilt. The D28 one-animator rule generalizes — the **topmost swapped view** animates and everything below it rides along.
- **Route snapshot (v1.15, D47):** inside any routed `data()` run, `this.route` describes the navigation being gated — the only route source that is correct pre-commit (`router.current` and `location` still hold the old route there). See §19.

Flat routes (no `children`) are unchanged.

Full state machine and rationale: [[DOC-VIEW-LIFECYCLE]] (D17–D19, D30).

## 14. Router scroll behavior (v1.5)

The router owns **window scroll** across navigations. Shipped in v1.5 (D33); a router-only amendment — no compiler or runtime-kernel change, and it adds the first field to the frozen §2 config surface (`scrollBehavior`).

**Default (no config).**

- **push / link navigation → scroll to top** (`window.scrollTo(0, 0)`).
- **back/forward (popstate) → restore** the position that history entry was at when the user left it, **falling back to top** when none is saved.
- The **initial navigation never touches scroll** (the browser owns first paint).
- A **failed or superseded navigation never touches scroll** — the landing is resolved at commit and applied only once the view is on screen, so a nav that never commits leaves the window where it was.

Saved positions are held in an in-memory map and — since v1.10 (D41) — mirrored to `sessionStorage`, so back/forward restore survives a full page reload (see below).

**Timing.** The landing is applied **synchronously inside the router's commit** — after the incoming view is in the DOM, before the next paint, and **after the old view's `out` animation** (§12). Scroll therefore never jumps mid-transition or flashes the old offset on the wrong content.

**Mechanics.**

- `history.scrollRestoration = 'manual'` is set between `start()` and `stop()` (the previous value is restored on `stop()`), so the browser's automatic restoration — which fires on popstate **before** the old view has swapped out — never scrolls the wrong content.
- Positions are keyed by a per-entry `__puzzleScrollKey` stamped into `history.state`: `pushState` carries a fresh key; entries the router did not create (a foreign entry, or the initial one) get a key lazily via `replaceState` (preserving any other state).
- On **popstate** the outgoing position is saved under the **in-memory current key** *before* the target entry's key is adopted — the browser has already moved `history.state` to the target entry, so the key the window still shows must be read from the router's own bookkeeping, not from `history.state`.

**Config (`scrollBehavior`).** An optional field on the PuzzleApp config (v1.5 amendment to the frozen §2 surface):

- **omitted** → the default above.
- **`false`** → the router never touches scroll. For apps whose shell scrolls an inner panel rather than the window (e.g. the music example's `overflow-hidden` layout), where a window scroll-to-top is meaningless.
- **`(to, from, savedPosition) => {x, y} | null`** → custom. `to` and `from` are `{ path, params, route, chain }` snapshots (`from` is `null` on the initial navigation); `savedPosition` is the entry's saved `{x, y}` and is **non-null only on a pop** (`null` on push). A **falsy return** (`null`/`false`/`undefined`) leaves scroll alone; a **throw** is logged and treated as falsy — the navigation itself is unaffected.

**Anchor targets (v1.10, D41).** A `#anchor` suffix on a navigation target refines the **default push landing**: `push('/docs#faq')` (or a link whose href carries the fragment — the history-mode interceptor now preserves `url.hash` instead of dropping it) lands the window at `document.getElementById('faq')` (id `decodeURIComponent`-ed), **falling back to top** when no such element is in the committed DOM — including a v1.8 skeleton view whose anchor target hasn't rendered yet (the scroll is never re-applied when the real template lands). On a **pop**, a saved position still wins over the anchor. A custom `scrollBehavior` function still wins over everything; the anchor rides verbatim in `to.path`. Resolution happens inside the commit, after mount (an element position can't be computed off-DOM); timing is otherwise unchanged. In **hash mode** the anchor rides *inside* the fragment — `push('/docs#faq')` writes `#/docs#faq`, and `<a href="#/docs#faq">` is intercepted by the existing `#/` rule (browsers tolerate the double hash; bare `#faq` hrefs remain native, and remain the §15 hazard).

**Position persistence (v1.10, D41).** Every position save mirrors the in-memory map to a single `sessionStorage` key (`__puzzleScroll`); `start()` hydrates the map from it. Because per-entry `__puzzleScrollKey`s live in `history.state` — which survives reloads — reload + back/forward restores the pre-reload position. The map is capped at **50 entries, oldest evicted**. All storage access is fail-soft (`try/catch`): quota errors or disabled storage degrade to the v1.5 in-memory behavior exactly. `scrollBehavior: false` touches no storage.

**Not in v1.10** (Planned — not in v1.10):

- An `{ el }`-style return shape for custom `scrollBehavior` functions (the default anchor behavior covers the use case; the return contract stays `{x, y} | null`).
- Scroll retention inside non-window scroll containers; smooth-scroll options.

## 15. Hash routing (v1.6)

The router can carry the route in `location.hash` (`https://host/app/index.html#/user/123?tab=posts`) instead of the pathname. Shipped in v1.6 (D34); a router-only amendment — no compiler or runtime-kernel change, and it adds the **second** field to the frozen §2 config surface (`routerMode`, after v1.5's `scrollBehavior`). Hash mode is the deployment story for **static hosts** — GitHub Pages, an S3 bucket, `file://` — where you cannot configure the history-API fallback that pathname routing needs (serve `index.html` for every route). The pathname never changes, so no server rewrite is required.

**Config (`routerMode`).** An optional field on the PuzzleApp config, an enum:

- **omitted / `'history'`** → pathname routing (the v1.5 behavior, exactly).
- **`'hash'`** → the route lives in `location.hash`; the pathname is left alone.
- **`'memory'`** (v1.11, D42) → the route lives entirely in router state; `location` and `history` are never read or written — see below.

Any other value is a **constructor throw** (fail-fast, like the route-shape throws). `routerMode` passes straight through to `new Router(routes, { mode })`.

**Memory mode (v1.11, D42).** For tests (no jsdom history gymnastics) and embedded/iframe apps that must not touch the host page's URL. An in-memory entry stack replaces `history`: `push()` truncates forward entries and appends (browser semantics); `router.go(n)`/`back()`/`forward()` (§9) move the stack index and run the pipeline as a pop. The full D19/D28/D30 pipeline — atomic commit, cancellation, sequential transitions, nested chains — runs unchanged. Differences, all deliberate:

- **No document-level side effects:** no popstate listener, and `meta.title` does **not** set `document.title` (an embedded widget must not rename the host page's tab).
- **Scroll management is a no-op:** `scrollBehavior` is accepted but inert — there are no history entries to key restoration off, and an embed shares the window with a host page the router has no claim on.
- **The click interceptor stays active** (app code stays path-shaped and mode-agnostic): same-origin pathname links route in memory. *Embed caveat:* interception is document-global, so same-origin path links in the host page are intercepted too — the same trade hash mode makes; scope your embed's links accordingly.
- **`routerInitialPath`** (PuzzleApp config; Router option `initialPath`) names the first route, default `'/'` — there is no URL to read. Setting it in history/hash mode is a **constructor throw** (the URL is the initial path there; a silently ignored field would hide a config bug). Third amendment to the frozen §2 surface.

**The app-facing API stays path-shaped and mode-agnostic.** Route definitions, `push('/user/123')`, `current.path`, params, nested routes, `meta.title` — all identical in both modes. **No `#` ever appears in app code**; the hash is purely a URL-encoding detail the router owns. The mode choice is a one-line config change with no other edits. Since v1.46 (D79) this covers template hrefs too: write them path-shaped through the built-in `link` formatter — `href="{ '/user/' + id | link }"` — and `router.url()` (§9) encodes the mode-appropriate shape at render time. Hand-written `#/...` hrefs remain valid in hash mode (the interceptor is unchanged), but piped links are the portable spelling.

**What the mode changes — three seams only:**

- **Reading the current URL.** History mode reads `location.pathname + location.search`; hash mode parses `location.hash` — `''`/`'#'` → `/`; `#/...` → that path (an in-fragment `?query` rides along); any other fragment (`#section2`) is **not a route fragment**.
- **Writing the URL on push.** Hash mode calls `pushState` with `'#' + path` (the D33 `__puzzleScrollKey` still rides in `history.state`); the pathname is never touched.
- **The link interceptor.** In hash mode `<a href="#/about">` is intercepted and routed via `push` (full D19 semantics); a bare `<a href="#faq">` stays a native in-page anchor; a same-origin link with a **different** pathname falls through to the browser (a real navigation away from the app shell); a full URL on the **same** pathname carrying a `#/...` fragment is intercepted. Deliberately unchanged by D79: a plain `/x` href in hash mode is still a navigation away, never claimed — auto-claiming would break that escape hatch and still leave the attribute wrong for new-tab/copy-link, which is why path-shaped links go through the `link` formatter (which fixes the attribute itself) rather than the interceptor.

**Listening is popstate-only, in both modes** (never `hashchange`): fragment navigations fire `popstate` in supported browsers — the same bet Vue Router 4 makes (its hash history is the HTML5 history with a `#` base). A `popstate` whose hash is a **non-route** fragment routes `/` on initial load but is **ignored entirely** on the pop — the rendered view is left alone, so an in-page anchor traversal never tears down the app.

**Everything downstream is untouched and works identically in hash mode:** the D19/D61 atomic commit (the URL moves only after `data()` resolves — and, since v1.28, atomically with the incoming mount; a failed or superseded navigation moves nothing, §30), D28 transitions, D30 nested chains, and D33 scroll behavior (keys ride in `history.state` on the `pushState`).

**In-page-anchor limitation (inherent to hash routing).** In hash mode, clicking a bare in-page anchor (`#faq`) replaces the whole fragment, clobbering the current route from the URL. The rendered view survives (the pop is ignored) and back returns to the route, but the URL no longer names it. This is inherent to hash routing everywhere, not a Puzzle quirk — hash-mode apps should avoid bare-anchor links.

**Not in v1.11** (Planned — not in v1.11; `'memory'` mode itself shipped in v1.11 — above):

- Base-path support (hash-fragment base for sub-path hosting, and the history-mode equivalent — history mode assumes root deployment today). Deciding it properly means deciding it for both modes at once.
- Mount-scoped link interception for embeds (interception is document-global in all modes).

## 19. Route snapshot in `data()`: `this.route` (v1.15)

The route source that is correct **inside the navigation**. Shipped in v1.15 (D47); a router + PuzzleView amendment — no compiler, store, or ViewManager changes. The motivating case is the active-nav highlight (the Stays account tabs): on a sibling-pane swap the nav-owning view is a **reused ancestor** (§9 nested routes), and its `data()` re-runs as the pre-commit D19 gate — at which point `window.location` still holds the OLD URL and `router.current` the OLD committed state. A highlight derived from either lands exactly one navigation behind (and `location.pathname` was never right in hash mode, or meaningful in memory mode, anyway).

```js
// AccountShell.pzl — reused ancestor hosting Profile/Trips/Wishlist at <Slot/>
data(params, props) {
  const name = this.route.route.name; // the navigation THIS data() run is gating
  return {
    isProfile: name === 'account-profile',
    isTrips:   name === 'account-trips',
    isWishlist: name === 'account-wishlist',
  };
}
```

**Semantics.**

- `this.route` is `{ path, route, params, chain }` — **the same shape as `router.current`** (`route` = the leaf route node, `chain` = the root→leaf node list) — but it describes **the navigation that delivered this view's params**, not the committed state. Inside a gated `data()` run it names where the navigation is *going*; `router.current` still names where the app *is*. The two agree again the moment the navigation commits.
- The router threads one **frozen** snapshot per navigation through every gated `preload()`/`refresh()` (fresh views and reused ancestors alike) and through the reused layout's post-commit refresh. It rides the same channel as `params` — snapshot and params always describe the same navigation, in every router mode (history/hash/memory) and on push, pop, and initial navigation alike.
- A **store-change** re-run (`refresh()` with no arguments) keeps the stored snapshot — `this.route` only moves when a navigation delivers a new one.
- `this.route` is `null` for components the router does not manage (a plain component mounted by a parent template). Non-routed components that need route state should receive it as props from their routed ancestor.
- **Failure semantics are inherited from params, not widened:** a failed or superseded navigation still changes neither the URL nor `router.current` (D19). A reused ancestor whose sibling's `data()` later rejects has, however, already refreshed and re-rendered with the target's params *and* snapshot — the pre-existing, documented D19/D30 soft-violation, with `route` now riding alongside `params`.
- **Ordering fix that shipped with it:** a reused root layout's post-commit refresh now runs **after** `#commitState` (matching the params-only branch), so `router.current` read from a layout's `data()` is never stale either.

**Matching idiom, stated plainly:** compare **route names** (`this.route.route.name`, or `this.route.chain[0].name` for "which section am I in") rather than string-comparing `this.route.path` — names are immune to query strings, `#anchor` suffixes (D41), and mode differences. `path` is the raw pushed path and may carry both.

**What v1.15 deliberately does not add:** a reactive `router.current` (reading it in `data()` would subscribe the view and re-run post-commit — rejected for the double `data()` run and new store machinery; may layer on later as its own decision) and a `router.isActive(path)` matcher (pure sugar over `this.route`, deferred until real demand — see D47).

## 23. Router base path (v1.19)

Serve the app under a sub-path with one config line. Shipped in v1.19 (D51); router + config passthrough only.

```js
new PuzzleApp({ target: '#app', routes, models, routerBase: '/myapp' });
```

- **App code stays base-free.** Route definitions, `push('/user/1')`, `router.current`, `params`, and `this.route` never see the base — only the URL carries it. Applied at the path-shape boundary: reads strip it after the mode-specific raw read; writes prefix it before the mode-specific encoding.
- **History mode:** URL is `/myapp/user/1`. The click interceptor intercepts only same-origin URLs **under the base** (stripped on push); same-origin links outside the base fall through to the browser — a real navigation away from the app. Loaded at a pathname outside the base: warn once, pathname passes through un-stripped (typically the catch-all).
- **Hash mode:** the base rides in-fragment — `#/myapp/user/1`; the D41 anchor convention composes (`#/myapp/docs#faq`). With a base set, the exact `#<base>` fragment (→ `/`) and `#<base>/...` fragments are routes; other `#/...` fragments are left to the browser like any non-route fragment.
- **Memory mode:** no URL — `routerBase` is accepted but inert (like `scrollBehavior` there), so one config runs under the test mode.
- **Hrefs are real URLs and carry the base** (`href="/myapp/user/1"`, or relative) — middle-click/copy-link/new-tab must work. `push()` paths never do.
- **Normalization:** leading `/` ensured, trailing `/` trimmed, `''`/`'/'` → no base (default; base-less apps byte-identical). A base containing `#` or `?` is a constructor throw.

## 26. Overlapping route transitions (v1.24)

Opt-in concurrent route transitions — the old view's `out` and the new view's `in` play at the same time (cross-fades, shared-axis slides). Shipped in v1.24 (D56); router + PuzzleApp config passthrough only. **Sequential stays the default**: a config without `transitionMode` behaves byte-identically to v1.23.

- **Config:** `transitionMode: 'sequential' | 'overlap'` on the PuzzleApp config (amending the §2 surface like `scrollBehavior`/`routerMode`). App-level default; since v1.30 also resolvable per-route (routes.js) and per-view/layout (a class field), destination-only — see §33 (D65).
- **Positioning (wrapper-free, D28 holds).** At out-start the router pins the outgoing animator's root **in place** with inline styles — `position: fixed` at its measured `getBoundingClientRect()` (plus `margin: 0`, `pointer-events: none`) — and mounts the incoming chain into the layout slot in the same synchronous block. No wrapper element is ever injected; in-flow content never stacks or jumps. The pinned leaver paints above in-flow content (it is positioned), and clicks pass through it to the live view.
- **Sequencing.** The out is started but **not awaited**: the location commit + mount proceed immediately in the same synchronous window (`data()` was already awaited before the swap — D19; since v1.28 the URL/title commit rides that window in both modes, §30/D61 — in overlap it simply isn't delayed by the out animation, which is the mode's point). The leaver is destroyed when its `out` settles. Enter stays fire-and-forget as in §12.
- **Hooks in the overlap window:** `viewWillHide()` fires at out-start; the new view's `mounted()`/`viewWillShow()` fire while the old view is still fading; `viewDidHide()`/`viewDidShow()` fire as each animation settles — their **relative order is unspecified**. Sequential mode's §12 ordering is untouched.
- **Interruption stays instant:** a navigation arriving mid-overlap tears the still-fading leaver down synchronously (the §12 posture) — at most two route elements ever coexist.
- **Unchanged:** initial navigation, params-only navigations, memory-mode semantics, reduced-motion (zeroed durations make overlap effectively instant), navigation-failure recovery (a doomed navigation never pins — the out only starts after `data()` resolves).
- **Constraints:** ancestors of the mount container must not carry `transform`/`filter`/`contain` (they'd re-root the `fixed` pin — the containing-block trap); document height snaps to the new view at commit (a cross-fade hides this); combining with a registered morph handler (§ D55) is best-effort — pick one mechanism per app.

## 30. Atomic location commit (v1.28)

The router's location side effects — `pushState`, `document.title`, the memory-mode stack/index, and the outgoing scroll-position save — commit **inside the swap's synchronous commit window, immediately before the incoming mount** (D61). One synchronous block now moves URL, title, DOM, and router state together. This restores D19's stated guarantee ("URL and view commit atomically") that v1.1's sequential transitions had silently stretched: from v1.1 through v1.27, URL/title moved the instant loads resolved, *before* the awaited `out` animation.

- **Sequential mode (default):** the commit runs only after the outgoing unit's `out` animation (and any morph-leave) settles and the final navigation-token checks pass. A push **superseded or failed during the out phase commits nothing** — no phantom history entry, no URL/view divergence (the two holes the early commit left open). Observable shift: URL/title update one out-animation later; apps with no `out` animation see no difference.
- **Overlap mode (§26):** unchanged timing — the out is never awaited, so the commit + mount proceed immediately, concurrently with the leave.
- **Params-only navigations:** unchanged timing — no animation is involved; location commits immediately before the state commit, as before.
- **Pop navigations:** the browser already moved the URL (popstate); the commit contributes title (+ memory-mode index) only. A *failed* pop can still leave the browser URL ahead of the rendered view — accepted asymmetry, no history rollback (unchanged from v1).
- **The D19 data gate is untouched:** failed loads still commit nothing; reused ancestors still gate; the §16 skeleton exemption still bypasses only the *data* gate (see the §16 note).
- **Scroll (§14/D33):** the outgoing entry's position is saved at commit (swap) time rather than click time — scrolling during the out animation is remembered.
- **Out of scope, unchanged:** a render/lifecycle exception *after* the location commit (mount throw) can still leave the URL ahead of the view; no rollback machinery exists (D61 rejected it as racy).

## 33. Per-route / per-view transition mode (v1.30)

`transitionMode` (§26) is resolvable at finer granularity than the single app-wide switch. Shipped in v1.30 (D65); router-only amendment, amends D56. **An app that sets none of this is byte-identical to v1.24–v1.29** — the app-level `transitionMode` option keeps working exactly as before, unchanged in meaning for anyone who never touches the new surfaces.

- **Three tiers, most specific first, resolved fresh per navigation:**
  1. A `transitionMode` field on a route (or child-route) definition in `routes.js`, sibling to `layout`/`meta` (not nested inside `meta` — `meta` is reserved for page-metadata like `title`; `transitionMode` is structural, like `layout`). Resolved by a **nearest-defined walk of the destination chain, leaf → root** — the exact walk `meta.title` already uses (§ D19/`#setTitle`) — so a parent route (e.g. a `/settings` shell) can set it once for every child that doesn't declare its own.
  2. A `transitionMode` field on the incoming animator's **view or layout class**, colocated with `animations`:
     ```js
     export default class GalleryView extends PuzzleView {
       transitionMode = 'overlap';
       animations = { in: {...}, out: {...} };
     }
     ```
     Layout classes qualify too — a layout is a `PuzzleView` subclass, and a layout swap's animator is the fresh layout instance, so this field works there unmodified.
  3. The app-level `transitionMode` constructor option (§26), now the **fallback** rather than the sole source.
- **Resolution is DESTINATION-ONLY.** For a navigation A→B, only B's configuration (across all three tiers) is ever consulted — A's own `transitionMode` (route or view field) has no bearing. The reverse navigation B→A is resolved independently and may play differently. This mirrors how `meta.title` and each view's own `animations.in` already work: the side being entered unilaterally controls its own arrival.
- **Why destination-only, not per-view generally:** D56 explicitly deferred a per-view override because a transition spans **two different instances** with no shared owner — letting either side's field win invites "spooky cross-view action" (one view's declared field controlling how a *different* view's animation plays). Resolving it directionally removes the ambiguity by construction: it is never a live negotiation between two sides, only a lookup on the side being entered. Generic nested/reusable components (`Button.pzl`, `Card.pzl`, …) are out of scope by construction, not by omission — D30's one-animator rule guarantees only a routed view or layout is ever consulted; everything else is `skipEnter()`'d during a route swap and never asked.
- **Validation:** an unknown route-level `transitionMode` value is a **construction-time throw**, same posture as the unknown-`transitionMode` constructor check (§26) and the other route-shape throws (bad child path, `layout` on a non-root node, etc.). An unknown view/layout-level field value **warns once per offending class** and falls through to the next tier, rather than throwing — a single misconfigured view must not crash navigation.
- **Unchanged:** everything else about §26/§30 — positioning, sequencing, hook ordering, interruption, the D61 atomic-commit window, morph interop, reduced-motion. This amendment only changes *which* of sequential/overlap is selected per navigation, never how either mode itself behaves.

## 44. Router query snapshot + `replace()` (v1.49)

URL-backed transient state — filters, tabs, search, pagination — becomes first-class (D83). Additive to §9/§19; `path` is unchanged.

**Snapshot fields.** The route snapshot (`router.current`, `this.route`) gains:

- `pathname` — `path` minus query and hash (still base-free; trailing slash kept verbatim, matching unchanged).
- `query` — a **frozen, null-prototype** object parsed with `URLSearchParams` decoding: a single value is a string; repeated keys become a frozen array in source order; a valueless key (`?debug`) is `''`. Malformed percent input never throws. Query values never merge into route `params`, and `data(params)` signatures are unchanged — views read `this.route.query`.
- `hash` — `''` or the raw leading-`#` fragment.

Parsing happens once per navigation; a query-only navigation to the same route runs the params-only refresh with the new snapshot, so `data()` reactivity composes with no new machinery.

**`router.replace(path)`.** Push's no-history-entry sibling: the identical match/load/cancellation/atomic-commit pipeline (§30 holds — a failed or superseded replace commits nothing), the same same-path no-op guard, and the same commit-window deferral. At commit: history mode `history.replaceState` (hash mode replaces the fragment entry) with the **current scroll-entry key kept** — it is the same history entry; memory mode overwrites `stack[index]` in place. **Replace never touches scroll by default** (a filter keystroke must not jump the page); a custom `scrollBehavior` (§14) still runs and may override. Static output's router stub throws for `replace` like every navigation method.

## 45. Route head management (v1.50)

Route `meta` grows **reserved head fields** — `title` (existing), `description`, `canonical`, `socialImage` — resolved per-field by one shared resolver, then delivered by two **disjoint** paths: the browser assigns `document.title` on every navigation, and the prerender bakes the managed `og:`/`twitter:`/description/canonical tags into each page's HTML at build time. One contract, no second head DSL (D84, amended by D111).

- **Resolution:** each reserved field resolves independently, nearest-defined walking the destination chain leaf → root (the `meta.title` walk); `undefined` inherits, `null` explicitly suppresses an inherited value. Values are static strings or `null` — no functions, view data, raw HTML, or tag arrays. Custom `meta` keys are untouched. Canonical values are emitted as provided (supply absolute URLs).
- **Generated tags:** `title` → `<title>` + `og:title` + `twitter:title`; `description` → description + `og:description` + `twitter:description`; `canonical` → `<link rel="canonical">` + `og:url`; `socialImage` → `og:image` + `twitter:image` + `twitter:card=summary_large_image`. Every managed tag carries `data-puzzle-head="<field>"`, marking it as framework-owned in the served HTML; unmarked head elements in the shell are never touched.
- **SSG (the only managed-tag path):** the shell injection replaces same-identity managed tags, removes ones whose field no longer resolves, and inserts the rest before `</head>` — escaped, deterministic string surgery (no HTML parser). Prerender results carry a resolved `head` beside the compatibility `title`. Because crawlers and unfurlers GET each URL fresh and never client-navigate, the tags baked into that page are always the copy they read.
- **SPA:** the browser syncs **`document.title` only**, at the same commit point as before, so §30 atomicity covers it — a failed or superseded navigation never touches it. Only a non-null resolved title assigns; no resolved title anywhere leaves `document.title` alone, and memory mode performs no document work (§16 posture, D42). The runtime does **not** sync managed tags in any output mode (D111): the browser-side `syncTags` is deleted, so `headTags.js` is build-time only and enters no browser bundle. Under `output: 'spa'` — which has no prerender pass — `description`/`canonical`/`socialImage` are therefore accepted but inert.
- Applications using managed fields should define root-route defaults so child routes cannot leave stale inherited values.

## 48. Route guards: the `guard` route field (v1.53)

Client-side navigation middleware (D87). Any route node — root, child, or the catch-all — may declare `guard: fn`, a plain function `({ to, from, ctx }) => verdict`. A navigation's effective chain is every declared guard along the matched root → leaf chain, run **sequentially in that order**, short-circuiting on the first non-allow verdict — so guarding a top-level route locks its entire layout subtree with one declaration, and a child may add a stricter check of its own on top.

- **Placement in the pipeline:** guards run once per **matched** navigation — push, replace, popstate, params-only, query-only, and navigation #0 — after matching and the cancellation-token bump, before any view/layout construction and before the D19 load gate. A denied navigation commits nothing (§30: URL, history, title, tree, and scroll all untouched) and has no fresh instances to tear down. The same-path no-op (§44) means a push to the committed path never reaches guards at all.
- **Arguments:** `to` and `from` are the frozen route snapshots (§19/§44 shape); `from` is `null` on navigation #0. `ctx` is the app context (`store`, `router`, `formatters`).
- **Verdicts:** `undefined`/`true` allows. `false` blocks — stay put. A string path redirects: the **router** performs it with `replace()` semantics (§44), so the denied URL never enters history and the destination's own guards run normally through the standard pipeline. Guards may be async — the router awaits each one, and the cancellation token makes a superseded guarded navigation abandon silently. A guard that throws follows the data()-failure posture: logged, stay put.
- **Loop safety:** a guard redirect to the committed path is the §44 same-path no-op. At most ten guard redirects may run without an intervening commit; the next is treated as a cycle — `console.error`, stay put. A successful commit resets the counter.
- **Validation:** a `guard` that is present but not a function throws at construction (root, child, and catch-all alike).
- **Output modes:** guards are SPA-runtime behavior and a UX affordance, **not a security boundary** — prerendered files are public bytes and data must be authorized server-side. The hybrid prerender pass warns per rendered page whose chain declares a guard (its markup ships publicly; `prerender: false` anywhere in the chain is the quiet opt-out); a static build (§36) warns once when any route declares a guard — there is no router, so guards never run. Warnings only; no build behavior changes.
- **Idioms (documented, not new API):** restore sessions in `beforeMount(app)` (§34 — awaited before navigation #0) so guards can be synchronous store reads; async guards remain supported. Redirect-after-login: the guard returns `'/login?redirect=' + encodeURIComponent(to.path)`, and the login view reads `this.route.query.redirect` (§44) and `router.replace()`s it after sign-in.

## 51. Router focus management + route announcement: `focusBehavior` (v1.56)

After every committed navigation the router moves focus to the incoming view and announces the new title (D93) — the runtime half of the accessibility story §43 started at compile time. `focusBehavior` mirrors `scrollBehavior` (§14): omit for the default, `false` to opt out entirely, a function to choose the target.

- **Where it runs.** In `#commitState`, the same synchronous post-mount / pre-paint window that owns scroll, and **strictly after** the scroll block so the window position is final first.
- **`focus({ preventScroll: true })` is mandatory.** A default `focus()` scrolls the element into view and would fight the `window.scrollTo` immediately above it, silently breaking §14 restoration and §22-era anchor landings (D41).
- **`tabindex="-1"` is transient** — stamped before focusing, removed on the element's `blur`. A `<puzzle-view>` root is not natively focusable, but it must not become a permanent tab stop. **An author-set `tabindex` is never touched.**
- **One framework-owned live region**, created at `start()` and removed at `stop()`: `aria-live="polite"`, `aria-atomic="true"`, visually hidden by clip-rect (`display:none`/`visibility:hidden` would suppress announcement). It receives `document.title`, which §45's commit path has already updated — read, never re-derived. *(Amended, D119: aria-live announces on CHANGE only, and a route resolving no `meta.title` deliberately leaves the previous title standing — so the title is announced only when non-empty and actually moved since the last announcement; otherwise the region receives the committed route's `name`, or its `path` when the name would repeat the region's content. Without the fallback, an app with no per-route titles announced nothing after its first navigation, and a mixed app announced the page the user just left.)*
- **Resolution is split.** The *gate* (does focus apply at all) resolves pre-commit; the *target* resolves post-mount, because a custom function returns an element and the incoming chain is not in the DOM until commit. This is the same shape D41's `{ anchor }` sentinel already uses.
- **Skips:** memory mode is a full no-op (an embed shares the window with a host page — same reasoning as §14's scroll gate); navigation #0 does nothing, the browser owns first paint. Failed or superseded navigations never reach the commit point.
- **`push`, `replace`, and `pop` all move focus.** Browsers do not restore focus for client-side navigation.
- **A custom function that declines focus still announces** — the route changed. Focus is applied before the announcement, because a polite update issued immediately before a focus change is routinely dropped by assistive tech. A throw is logged and treated as falsy, matching §14's posture.
- **Output modes:** `output: 'static'` pages have no router (§36), so they get neither focus management nor a live region.

