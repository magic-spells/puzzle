---
name: Router
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ANIMATIONS
  - COMPONENT-MORPH
  - COMPONENT-SSG
  - FILE-ROUTER
  - FILE-ROUTE-TREE
  - FILE-ROUTE-VIEWS
  - FILE-ROUTE-NAMES
  - DOC-SPEC-ROUTER
  - FLOW-NAVIGATION
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D182-NAVIGATION-RESULT
  - DECISION-D195-LINK-PREFETCH
  - DECISION-D196-NAMED-ROUTES
verified_at: '2026-11-24T18:05:31.213Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: state
    text: >-
      While the browser sits on a popped entry, two rules hold in #handlePopState and #navigate: (1)
      a popstate home to the committed entry (the D41 fragment branch, e.g. Back then Forward before
      the Back lands) supersedes a pop still loading (`#popInFlight && #pendingNavPromise`) with
      `#recoverFailedNavigation(++#token)` before #applyFragmentPop, so URL and tree stay together;
      a push or replace still loading writes its own URL at commit, so it is left to land; (2) no
      scroll save while `#urlMoved` is set: #scrollKey already names the popped entry, which was
      never on screen, so neither a second popstate nor a push over it files the live position under
      that key (departScroll is null; #commitLocation skips the save). Tests:
      tests/router-fragment-pop.test.js "over a pop still loading". Open and not built: an overlap
      recover restores a dead leaver; navigation zero is invisible to the same-path rules (the
      fragment guard still needs a committed #state).
  - kind: decision
    text: >-
      The default focus target (`#resolveFocusTarget`, no custom focusBehavior) respects a view that
      chose its own focus. If focus is not already inside the committed leaf root (a `mounted()`
      focus call), it calls `focus({ preventScroll: true })` on the leaf's first `[autofocus]`
      element; then it asks the DOM where focus is: inside the root returns null (no move, still
      announces), anywhere else returns the root. Asking where focus landed covers a hidden,
      disabled, inert or closed-`<dialog>` autofocus target (the pieces AlertDialog's Cancel button)
      with no visibility logic, so `#focusElement` only ever receives the root or a custom return.
      Why: `#applyFocus` runs after mount, so moving focus to the root stole it from an input the
      view had focused (music Search), and browsers honour `autofocus` on first load only. For D135:
      a params-only push from a control inside the reused leaf leaves focus on that control when the
      patch keeps it; if the control is gone, the root takes focus. Rejected: returning the
      `[autofocus]` element as the target (a closed dialog's button takes no focus, so focus fell to
      body); handling `autofocus` only (a view that focuses in `mounted()` would still lose focus);
      a reused-view flag to keep D135's old push behaviour.
  - kind: state
    text: >-
      Popstate saves the outgoing position from `#shown`, the window position as of the last
      `scroll` event (listener added in `start()` when scroll is enabled, removed in `stop()`); a
      push saves `departScroll`. Neither path reads the window at commit.
---

# Router

Route compiler and navigation state machine. The public contract is [[DOC-SPEC-ROUTER]]; the ordered steps of one navigation are [[FLOW-NAVIGATION]]. This card holds the implementation contracts and the traps.

## Files

- `router/router.js` — the Router class: route compile, `#navigate`, `#swap`, `#commitLocation`, `#commitState`, scroll, focus, interception. Also exports `encodeURL`, `normalizeBase`, `localeBase`, `linkLocale`, `localePage`.
- `router/routeTree.js` — the one nested-routes → leaf flatten (`walkRouteTree`), shared with the SSG pass.
- `router/routePath.js` — path canonicalization and dynamic-segment shape (D126), shared with prerender.
- `router/routeNames.js` — named route targets ([[DECISION-D196-NAMED-ROUTES]]): the name table and `targetPath`, which turns `{ name, params, query, hash }` into a path string before anything else reads it. DOM-free, so the live Router (`url`, `push`, `replace`, `prefetch`, guard redirects), the hybrid prerender's `url()` shadow, the static router stub and the static page kernel (which reads the table from the page's names island) resolve names by one rule.
- `router/viewClass.js` — view/layout value checks, kept out of `lazy.js` so validation survives the `__PUZZLE_HAS_LAZY__` fold.
- `router/lazy.js` — the `lazy()` marker and resolver ([[DECISION-D163-LAZY-ROUTE-VIEWS]]).
- `router/prefetch.js` — link prefetch ([[DECISION-D195-LINK-PREFETCH]]): document intent listeners, the `data-prefetch="visible"` scan, the per-router `prefetch` default in a WeakMap. Reached only behind the `__PUZZLE_HAS_LAZY__` probe.
- `router/routeViews.js` — `router.views` and the dev-only `agent` checks (D183).
- `router/modes.js` — the hash and memory factories behind `@magic-spells/puzzle/router-modes` ([[DECISION-D159-ROUTER-MODE-FACTORIES]]). Path routing is inline, so a path-mode bundle carries neither.

## URLs and modes

- `url()` calls the exported `encodeURL(path, mode, base)`. The static stub and the hybrid prerender use the same function ([[COMPONENT-SSG]]), so prerendered and client hrefs cannot drift.
- **Canonical path form is percent-encoded** (what `location.pathname` reports). One normalizer runs at every boundary — route compile, `push`, `replace`, `url`, the memory initial path, `routerBase`. It encodes whole non-ASCII runs plus space `"` `<` `>` `` ` `` `{` `}` `^`, never `?`/`#`, and leaves everything else byte-identical, so it is idempotent. Param values are decoded once at match time; never double-decode.
- `#syncHead` is `syncTitle(headText(resolveHeadField(chain, 'title'), ctx.i18n))`. The `headText` call sits behind `__PUZZLE_HAS_I18N__`, so apps without i18n keep their bytes. The other head fields are build-time only ([[DECISION-D84-HEAD-MANAGEMENT]]).

## Locale prefix routing

[[DECISION-D177-LOCALE-URL-PREFIXES]]. Every branch sits behind the inline `__PUZZLE_HAS_LOCALE_ROUTING__` probe, so apps without `i18n.routing` ship none of it.

- **Composed `#base`.** With prefix routing in path mode the constructor sets `#base = localeBase(routerBase, locale, defaultLocale)` once. Reading, writing and click interception use it; matching and `this.route` stay locale-free. It never changes while the app runs — `setLocale` is a page load. A route whose first segment is a non-default locale tag throws.
- **`localeRouting` WeakMap** (module level, at the end of the file): Router → `{ base, locale, defaultLocale, locales, target, page }`. `target` is the in-flight navigation's path (`setLocaleTarget`, set for every verb in `#navigate`, cleared at commit or failure); `page()` reads `target ?? #state.path`. A WeakMap rather than private fields, because a class field would ship in every app. `localePage(router)` returns `router.url(page())` — the page `setLocale` reloads.
- **`url(path)` options** are read from `arguments[1]` through `linkLocale`, so the method keeps one declared parameter (a JSDoc `@overload` types the second).
- **Click interception:** after the mode's own `linkPath` seam, a link is taken only when `localeBase(routing.base, pathLocale(url.pathname, …), defaultLocale)` equals `#base`. `pathLocale` is the single prefix matcher, shared with `i18n.js`.
- `push('/es/…')` routes as written and warns in development.

## Route table

Nested definitions flatten to leaf matchers in declaration order: children relative, empty child = index, layouts top-level only, top-level `*` = catch-all (`#catchAll`, matched last), merged params, nearest-leaf metadata wins. Construction throws on duplicate params, absolute child paths, nested catch-alls or layouts, bad transition modes, non-function guards, a `view`/`layout` that is neither a `PuzzleView` subclass nor a `lazy()` marker, and bad base or mode config. Production keeps each diagnosis; how-to-fix tails are dev-only.

Each leaf precomputes its guard chain (`entry.guards`, root → leaf) and, when it has no `lazy()` marker, its class array — lazy-free apps pay nothing per navigation. `routeEntries` is the SSG's view of the compiled leaves. The dev-only checks (`warnShadowedPaths`, `checkAgentRoutes`) run in the constructor's `__PUZZLE_DEV__` block.

`router.views` is a getter cached in `#views`, built by `routeViews(#routes)`. The router never reads `agent` during navigation.

## Navigation pipeline

1. **Guards** (D87) run in `#runGuards` after the token bump, before any construction, root → leaf, token-checked across awaits; an empty chain adds no await. A throwing guard and the ten-redirect cap both return an `{ error }` marker (never `false`) so the result is `'error'`. A string redirects through `push()` for a push, `replace()` for a pop or navigation #0.
2. **Lazy views** resolve only after every guard allowed, all markers through one `Promise.all`, before reuse calculation, constructors and `data()`.
3. **Load:** compute the shared prefix, preload fresh views, prepare reused ancestors (D146 — their gated `data()` runs against the destination but commits only in `#commitState`; `#navigate`'s `finally` discards the prepared runs on every exit that does not commit, so a new exit needs its own discard only when it awaits before that `finally` runs, as the data-failure bail does). One frozen snapshot per navigation (`parseLocation`, D83). The D39 skeleton gate must start every gated load before any skeleton-exempt preload opens its tracking scope.
4. **Commit** (`#commitLocation` then `#commitState`, one synchronous window): location/history and title, mount, `current`, scroll, focus, and the dev-only D100 route emit ([[FILE-DEVTOOLS]]).

## Link test and prefetch (D195)

- `#linkPath(a)` is the single answer to "which in-app path would a click on this link navigate to" (null when a click would not be intercepted): `target`, `download`, the hash mode's `fragmentPath` for `#…`, `mailto:`/`tel:`, origin, the mode's `linkPath`, the locale-prefix check, `stripBase`. `#handleClick` and prefetch both call it, so a link never prefetches where a click would not navigate. The mode seams are pure (they return a path or null; the caller pushes).
- `#prefetch(path, explicit)` matches and calls `resolveRouteViews(entry)` — D163's memoized resolver, so prefetch and navigation share one in-flight load. Without `explicit`, an entry with guards returns `false` before loading (gated code never downloads on its own). It never runs guards and never rejects. `router.prefetch(target)` is the explicit public form; it resolves a named target through `targetPath` first, as `push()` does.
- `watchLinks` runs at `start()` only when some entry or the catch-all has a marker; `stop()` calls `unwatchLinks`. The `prefetch` option is read from `arguments[1]` and validated in `prefetch.js`, so a lazy-free build carries no field, check or message for it.

## Navigation results (D182)

[[DECISION-D182-NAVIGATION-RESULT]].

- **Every `#navigate` exit returns a `NavigationResult`** — `fail(reason, err)`, `SUPERSEDED`, or `succeed(route)`. A new exit path that forgets this makes `push()` resolve `undefined`.
- **The in-flight slot.** `#navigate` opens `#pendingNavPromise` with the module-private `PENDING` promise at its token bump; every verb's caller pairs the real promise through `#trackNav`, which writes only over `PENDING`. A navigation that ended inside its synchronous start has already cleared the slot, so nothing latches and `navigating()` (D185) reads false.
- `#isCommittedNoop` gates the same-path no-op: committed path, chain intact, nothing in flight (`#guardRedirecting` exempt). `#joinInFlight` hands a same-key push or replace the in-flight navigation's promise from `#pendingNavPath`/`#pendingNavPromise` (a `PENDING` slot is re-read one microtask later); a guard redirect skips the join, or a guard redirecting to its own path would await itself forever.
- **Commit-window throws:** the outer catch around the load/`#swap` block may run after `#commitLocation`, while `#state` still names the old route. When it owns the token it clears `#pendingNavPath`, `#pendingNavPromise` and the locale target, and sets `#state.chainInvalid`. It rethrows only for navigation zero (or a guard redirect continuing it, which `#guardStart` marks), so `app.mount()` keeps its teardown.
- **`#pendingPush`** (the commit-window deferral slot) carries the caller's resolver. Anything that clears the slot — a displacing `#defer`, `stop()` — must resolve the old entry `SUPERSEDED`, or that caller waits forever.

## Failure invariants

- **A view/layout constructor throw** is a pre-commit failure like a lazy rejection: `onError` phase `navigation`, shared recovery (`#recoverFailedNavigation`), retryable. Abandoned instances are dropped, never `destroy()`ed (their `created()` never ran).
- **Failed-pop URL repair.** A push moves the URL only at commit (pushState); a popstate moves it first. `#urlMoved` says the browser sits on a popped entry: `#handlePopState` sets it, a navigation that supersedes a pop still loading keeps it, and `#commitLocation` clears it. Every pre-commit exit (blocked guard, no-op redirect, lazy rejection, constructor throw, `data()` rejection) goes through `#recoverFailedNavigation`, which repairs the URL once, for the token owner only. Tests: `tests/router-failed-pop-url.test.js`.
- **Fragment pops** (`#applyFragmentPop`) mutate `#state` in place, so `router.current.hash` moves but a view's frozen `this.route` does not (D41: not a navigation).
- **A `data()` failure with nothing committed yet** (a first load, or a navigation that starts before anything has committed; not a hybrid takeover) cannot stay put. The gate catch parks the failure on the top unit (layout, else root view) through `__showErrorView`, destroys the other fresh views and commits. The top unit's preloaded `mount()` flushes it before painting, so the error view (or marker) takes its position, the chain commits invalid (retry is a full rebuild), and the dev missing-`<Outlet/>` warning skips the destroyed chain.
- **Routed mount/refresh failure** ([[DECISION-D145-ERROR-BOUNDARIES]]) marks the chain non-reusable, destroys the failed view, and puts the app error view (or an invisible marker) in its exact position. Retry forces a same-location `replace` with `chainInvalid` (keep = 0); the replacement is held until the commit disposes it or a new failure swaps it, so no pre-commit exit leaves the position empty.

## Same-location rebuild (locale switch)

`__failedView(null, true)` sets `chainInvalid`/`layoutInvalid` and re-navigates the committed path in replace mode with `retryView = REBUILD` (a module-private marker). The marker takes the skeleton-exempt path, skips scroll and focus, `skipEnter()`s fresh levels and parks the outgoing unit as `#pendingOut` (destroyed without its out animation). Every test of it sits behind the inline `__PUZZLE_HAS_I18N__` probe — a new class member would ship in every app.

With a navigation in flight (`#pendingNavPromise` set — every verb pairs it, and it is cleared the moment a navigation ends, even inside its own synchronous start) it schedules `pending.then(again, again)` and returns null, so `setLocale` never waits on a navigation whose `data()` or guard may be awaiting it. A switch from inside a navigation's synchronous start (a layout's `data()` on first load) reads `PENDING`, which resolves one microtask later, by when the real promise is paired; it rebuilds once navigation zero commits. With none pending, the promise resolves on the rebuilt commit and rejects on failure. Tests: `tests/i18n-app.test.js`.

## Mounting and transitions

- The chain becomes nested keyed component vnodes through each `<Outlet/>`. The **whole** chain is rebuilt each navigation — a survivor-only swap would be reverted by a later ancestor re-render. The shared prefix keeps its instances; the topmost divergent view or a changed layout is the sole animator. A missing outlet warns in development.
- Sequential mode awaits the old unit's out phase before commit; a failing leave hook is logged and the swap continues. Overlap pins the leaver at its measured fixed rect and commits the entrant at once. Interruptions synchronously destroy doomed pending-out subtrees. Enter hooks go through `#playInLogged`.
- Morph seam: `leave(oldRoot)` at out start (awaited before destroy), `enter(newRoot, { initial })` post-commit, pre-paint; errors logged, never wedge; params-only updates fire no morph hooks.
- **Hybrid takeover** ([[DECISION-D67-HYBRID-PRERENDER]]): matching `data-puzzle-ssg` markup at navigation zero is replaced in the commit window, the marker removed, the initial enter skipped. A failed takeover mount first offers the position to the error view; otherwise the snapshotted prerendered nodes and marker are restored ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]), and every container-mount branch re-runs the takeover clear. Static output has no router.
