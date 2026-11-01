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
  - DOC-SPEC-ROUTER
  - FLOW-NAVIGATION
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D177-LOCALE-URL-PREFIXES
  - DECISION-D182-NAVIGATION-RESULT
verified_at: '2026-11-01T19:25:13.521Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Router

Route compiler and navigation state machine. The public contract is [[DOC-SPEC-ROUTER]]; the ordered steps of one navigation are [[FLOW-NAVIGATION]]. This card holds the implementation contracts and the traps.

## Files

- `router/router.js` — the Router class: route compile, `#navigate`, `#swap`, `#commitLocation`, `#commitState`, scroll, focus, interception. Also exports `encodeURL`, `normalizeBase`, `localeBase`, `linkLocale`, `localePage`.
- `router/routeTree.js` — the one nested-routes → leaf flatten (`walkRouteTree`), shared with the SSG pass.
- `router/routePath.js` — path canonicalization and dynamic-segment shape (D126), shared with prerender.
- `router/viewClass.js` — view/layout value checks, kept out of `lazy.js` so validation survives the `__PUZZLE_HAS_LAZY__` fold.
- `router/lazy.js` — the `lazy()` marker and resolver ([[DECISION-D163-LAZY-ROUTE-VIEWS]]).
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
- **Click interception:** after the mode's own `clickLink`, a link is taken only when `localeBase(routing.base, pathLocale(url.pathname, …), defaultLocale)` equals `#base`. `pathLocale` is the single prefix matcher, shared with `i18n.js`.
- `push('/es/…')` routes as written and warns in development.

## Route table

Nested definitions flatten to leaf matchers in declaration order: children relative, empty child = index, layouts top-level only, top-level `*` = catch-all (`#catchAll`, matched last), merged params, nearest-leaf metadata wins. Construction throws on duplicate params, absolute child paths, nested catch-alls or layouts, bad transition modes, non-function guards, a `view`/`layout` that is neither a `PuzzleView` subclass nor a `lazy()` marker, and bad base or mode config. Production keeps each diagnosis; how-to-fix tails are dev-only.

Each leaf precomputes its guard chain (`entry.guards`, root → leaf) and, when it has no `lazy()` marker, its class array — lazy-free apps pay nothing per navigation. `routeEntries` is the SSG's view of the compiled leaves. The dev-only checks (`warnShadowedPaths`, `checkAgentRoutes`) run in the constructor's `__PUZZLE_DEV__` block.

`router.views` is a getter cached in `#views`, built by `routeViews(#routes)`. The router never reads `agent` during navigation.

## Navigation pipeline

1. **Guards** (D87) run in `#runGuards` after the token bump, before any construction, root → leaf, token-checked across awaits; an empty chain adds no await. A throwing guard and the ten-redirect cap both return an `{ error }` marker (never `false`) so the result is `'error'`. A string redirects through `push()` for a push, `replace()` for a pop or navigation #0.
2. **Lazy views** resolve only after every guard allowed, all markers through one `Promise.all`, before reuse calculation, constructors and `data()`.
3. **Load:** compute the shared prefix, preload fresh views, prepare reused ancestors (D146 — their gated `data()` runs against the destination but commits only in `#commitState`; any new non-committing exit must discard the prepared runs, or their subscriptions strand on a live ancestor). One frozen snapshot per navigation (`parseLocation`, D83). The D39 skeleton gate must start every gated load before any skeleton-exempt preload opens its tracking scope.
4. **Commit** (`#commitLocation` then `#commitState`, one synchronous window): location/history and title, mount, `current`, scroll, focus, and the dev-only D100 route emit ([[FILE-DEVTOOLS]]).

## Navigation results (D182)

[[DECISION-D182-NAVIGATION-RESULT]].

- **Every `#navigate` exit returns a `NavigationResult`** — `fail(reason, err)`, `SUPERSEDED`, or `succeed(route)`. A new exit path that forgets this makes `push()` resolve `undefined`.
- `#isCommittedNoop` gates the same-path no-op: committed path, chain intact, nothing in flight (`#guardRedirecting` exempt). `#joinInFlight` hands a same-key push or replace the in-flight navigation's promise from `#pendingNavPath`/`#pendingNavPromise`; a guard redirect skips the join, or a guard redirecting to its own path would await itself forever.
- **Commit-window throws:** the outer catch around the load/`#swap` block may run after `#commitLocation`, while `#state` still names the old route. When it owns the token it clears `#pendingNavPath`, `#pendingNavPromise` and the locale target, and sets `#state.chainInvalid`. It rethrows only for navigation zero (or a guard redirect whose chain box has `start`), so `app.mount()` keeps its teardown.
- **`#pendingPush`** (the commit-window deferral slot) carries the caller's resolver. Anything that clears the slot — a displacing `#defer`, `stop()` — must resolve the old entry `SUPERSEDED`, or that caller waits forever.

## Failure invariants

- **A view/layout constructor throw** is a pre-commit failure like a lazy rejection: `onError` phase `navigation`, shared recovery (`#recoverFailedNavigation`), retryable. Abandoned instances are dropped, never `destroy()`ed (their `created()` never ran).
- **Failed-pop URL repair.** A push never moved the URL (pushState at commit); a pop did. All five pre-commit failure sites (blocked guard, no-op redirect, lazy rejection, constructor throw, `data()` rejection) run `if (pop && cur && this.#state === cur) this.#restoreCommittedUrl(cur.path)`. A guard-redirect continuation carries a mutable ownership box re-stamped on every re-entry; it repairs only when the box's token is still current **and** the state is still `cur` — neither test alone works across re-entry. Tests: `tests/router-failed-pop-url.test.js`.
- **Fragment pops** (`#applyFragmentPop`) mutate `#state` in place, so `router.current.hash` moves but a view's frozen `this.route` does not (D41: not a navigation).
- **Routed mount/refresh failure** ([[DECISION-D145-ERROR-BOUNDARIES]]) marks the chain non-reusable, destroys the failed view, and puts the app error view (or an invisible marker) in its exact position. Retry forces a same-location `replace` with `chainInvalid` (keep = 0); the replacement is held until the commit disposes it or a new failure swaps it, so no pre-commit exit leaves the position empty.

## Same-location rebuild (locale switch)

`__failedView(null, true)` sets `chainInvalid`/`layoutInvalid` and re-navigates the committed path in replace mode with `retryView = REBUILD` (a module-private marker). The marker takes the skeleton-exempt path, skips scroll and focus, `skipEnter()`s fresh levels and parks the outgoing unit as `#pendingOut` (destroyed without its out animation). Every test of it sits behind the inline `__PUZZLE_HAS_I18N__` probe — a new class member would ship in every app.

With a navigation pending (push, replace, pop and navigation zero all fill `#pendingNavPromise`) it schedules `pending.then(again, again)` and returns null, so `setLocale` never waits on a navigation whose `data()` or guard may be awaiting it; a switch from a layout's `data()` on first load rebuilds once navigation zero commits. With none pending, the promise resolves on the rebuilt commit and rejects on failure. Tests: `tests/i18n-app.test.js`.

## Mounting and transitions

- The chain becomes nested keyed component vnodes through each `<Slot/>`. The **whole** chain is rebuilt each navigation — a survivor-only swap would be reverted by a later ancestor re-render. The shared prefix keeps its instances; the topmost divergent view or a changed layout is the sole animator. A missing outlet warns in development.
- Sequential mode awaits the old unit's out phase before commit; a failing leave hook is logged and the swap continues. Overlap pins the leaver at its measured fixed rect and commits the entrant at once. Interruptions synchronously destroy doomed pending-out subtrees. Enter hooks go through `#playInLogged`.
- Morph seam: `leave(oldRoot)` at out start (awaited before destroy), `enter(newRoot, { initial })` post-commit, pre-paint; errors logged, never wedge; params-only updates fire no morph hooks.
- **Hybrid takeover** ([[DECISION-D67-HYBRID-PRERENDER]]): matching `data-puzzle-ssg` markup at navigation zero is replaced in the commit window, the marker removed, the initial enter skipped. A failed takeover mount first offers the position to the error view; otherwise the snapshotted prerendered nodes and marker are restored ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]), and every container-mount branch re-runs the takeover clear. Static output has no router.
