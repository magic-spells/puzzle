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
  - DECISION-D163-LAZY-ROUTE-VIEWS
verified_at: '2026-09-25T10:47:50.423Z'
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
---

# Router

Route compiler and navigation state machine (`router/router.js`). Public surface and
semantics are [[DOC-SPEC-ROUTER]]; this card is the implementation contract. Helper
modules: `routeTree.js` (the one nested-routes → leaf flatten, shared with the SSG
pass), `routePath.js` (path canonicalization + dynamic-segment shape, shared with
prerender), `viewClass.js` (view/layout value checks, kept out of `lazy.js` so
validation survives the `__PUZZLE_HAS_LAZY__` fold), `lazy.js` (D163 resolver),
`modes.js` (hash/memory factories).

## Modes and URLs

- PATH routing is inline and the default; hash and memory are mode objects imported
  from `@magic-spells/puzzle/router-modes` ([[DECISION-D159-ROUTER-MODE-FACTORIES]]), so a
  path-mode bundle carries neither. A mode string throws naming the import.
- `url()` calls the exported `encodeURL(path, mode, base)` (with `normalizeBase`), the
  SAME encoder the static stub and hybrid prerender use ([[COMPONENT-SSG]]) — copies had
  drifted before.
- **Canonical path form is percent-encoded** (what `location.pathname` reports). One
  normalizer runs at every boundary (route compile, `push`, `replace`, `url`, memory
  initial path, `routerBase`): whole non-ASCII runs plus space `"` `<` `>` `` ` `` `{`
  `}` `^`; never `?`/`#`. Everything else is byte-identical, so it is idempotent. Param
  values are decoded once at match time — never double-decode.
- Path/hash modes intercept safe same-origin unmodified links; hash keeps app paths
  base-free in the fragment; `routerBase` is inert in memory mode, which owns an entry
  stack and has no URL/title/scroll effects.
- `#syncHead` is `syncTitle(headText(resolveHeadField(chain, 'title'), ctx.i18n))`; the
  `headText` branch sits behind `__PUZZLE_HAS_I18N__` so `{ t: 'key' }` titles translate
  without changing the bytes of apps without i18n ([[DECISION-D84-HEAD-MANAGEMENT]]).

## Locale prefix routing (D177)

[[DECISION-D177-LOCALE-URL-PREFIXES]]; every branch sits behind the inline
`__PUZZLE_HAS_LOCALE_ROUTING__` probe, so apps without `i18n.routing` ship none of it.

- **Composed `#base`.** In path mode with prefix routing the constructor composes
  `#base = localeBase(routerBase, locale, defaultLocale)` once (`routerBase + /<locale>`
  for a non-default locale). Reading, writing and click interception all use it; route
  matching and `this.route` stay locale-free. It never changes while the app runs —
  `setLocale` is a page load. The constructor throws for a route whose first segment is
  a non-default locale tag.
- **`localeRouting` WeakMap** (module level, last in the module): Router →
  `{ base, locale, defaultLocale, locales, target, page }` — the bare `routerBase`, the
  configured tags, the in-flight navigation's path (`setLocaleTarget`, set for every
  verb in `#navigate`, cleared at commit or failure) and a `page()` closure that reads
  `target ?? #state.path`. A WeakMap rather than private fields, which would ship in
  every app. `localePage(router)` returns `router.url(page())`: the page `setLocale`
  reloads — the navigation's target when one is in flight, else the committed page.
- **`url(path)` options** are read from `arguments[1]` (`{ locale: 'es' }` or
  `{ locale: false }`, through `linkLocale`), so the method keeps one declared
  parameter; a JSDoc `@overload` types the second. The base comes from `localeBase` over
  `routing.base`.
- **Click interception:** after the mode's own `clickLink`, a link is taken only when
  `localeBase(routing.base, pathLocale(url.pathname, …), defaultLocale)` equals the
  router's `#base`; a link into another locale's pages (another prefix, or the default
  locale's unprefixed URL from a prefixed page) is a real page load.
- `push('/es/…')` routes as written and warns in development (app paths are
  locale-free). `pathLocale` is the single prefix matcher, shared with `i18n.js`.

## Route table

Nested definitions flatten to leaf matchers in declaration order (children relative,
empty child = index, layouts top-level only, top-level `*` = catch-all, merged params,
nearest-leaf metadata wins). Construction throws on duplicate params, absolute child
paths, nested catch-alls/layouts, bad transition modes, non-function guards, a
`view`/`layout` that is neither a `PuzzleView` subclass nor a `lazy()` marker, and bad
base/memory config. Production keeps each diagnosis; how-to-fix tails are dev-only.
Each leaf precomputes its inherited guard chain (`entry.guards`, root → leaf) and, when
it has no `lazy()` marker, its class array — lazy-free apps pay nothing per navigation.

## Navigation pipeline: guard → lazy → load → commit

1. **Guards** (D87) run in `#navigate` after the token bump, before any construction,
   sequentially root → leaf, token-rechecked across awaits; an empty chain adds no
   await. `false`/throw stays put via the shared failed-navigation recovery. A string
   redirects through `push()` when the denied navigation was a push, `replace()` for a
   pop or navigation #0 (the denied URL never enters history). Ten redirects without a
   commit trip the cycle cap.
2. **Lazy views** ([[DECISION-D163-LAZY-ROUTE-VIEWS]]) start only after every guard
   allowed, all markers together through one `Promise.all`, before reuse calculation,
   constructors and `data()`. A rejection is an ordinary pre-commit failure.
3. **Load**: compute the shared prefix, preload fresh views, prepare reused ancestors
   (D146 — their gated `data()` runs against the destination but commits only in
   `#commitState`; any new non-committing exit path must discard the prepared runs, or
   their subscriptions strand on a live ancestor). One frozen snapshot
   `{ path, pathname, query, hash, route, params, chain }` per navigation (`parseLocation`,
   D83). The D39 skeleton gate must start all gated loads before any skeleton-exempt
   preload opens its tracking scope.
4. **Commit** (`#commitState`, one synchronous window): location/history, title
   (`syncTitle(headText(resolveHeadField(chain, 'title'), ctx.i18n))`, the `headText`
   call behind `__PUZZLE_HAS_I18N__` — the other head fields are build-time only, D84),
   scroll bookkeeping, mounted tree, `current`, and the dev-only D100 route emit
   ([[FILE-DEVTOOLS]]), after `#commitLocation`.

Same-path push when committed is a no-op; while in flight it returns that navigation's
promise, so both callers settle at commit. The route announcement reads
`document.title`, falling back to the route name/path (aria-live announces only on
change). Trailing `/` is insignificant.

## Failure invariants

- **A view/layout constructor throw** is a pre-commit failure like a lazy rejection:
  `onError` phase `navigation`, shared recovery, retryable. Abandoned instances are
  DROPPED, never `destroy()`ed (their `created()` never ran).
- **Failed-POP URL repair**: after any failure that leaves the committed tree, the
  address bar must match the DOM. A push never moved the URL (pushState at commit, D61);
  a pop did, so all five failure sites (blocked guard, no-op redirect, lazy rejection,
  constructor throw, `data()` rejection) run `if (pop && cur && this.#state === cur)
  this.#restoreCommittedUrl(cur.path)` (a `replaceState`). A guard-redirect
  continuation carries a mutable ownership box re-stamped by every re-entry of the same
  chain; it repairs only when the box's token is still current AND the state is still
  `cur` (neither test alone works across re-entry). Pinned by
  `tests/router-failed-pop-url.test.js`.
- **Fragment pops** (`#applyFragmentPop`) mutate `#state` in place, so
  `router.current.hash` moves but a view's frozen `this.route` does not — by design
  (D41: not a navigation). Views that care read `ctx.router.current.hash`.
- **Routed mount/refresh failure** ([[DECISION-D145-ERROR-BOUNDARIES]]): marks the chain
  non-reusable, destroys the failed view, and puts the app error view (or an invisible
  marker) in its exact position. Retry forces a same-location `replace` with
  `chainInvalid` (keep = 0); the replacement is HELD until the commit disposes it or a
  new failure swaps it, so no pre-commit exit leaves the position empty.

## Same-location rebuild (D175 locale switch)


`__failedView(null, true)` sets `chainInvalid`/`layoutInvalid` and re-navigates the
committed path in replace mode with `retryView = REBUILD` (module-private marker). The
marker takes the skeleton-exempt path, skips scroll and focus/announcement,
`skipEnter()`s fresh levels and parks the outgoing unit as `#pendingOut` (destroyed
without its out animation). Every test of it sits behind the inline
`__PUZZLE_HAS_I18N__` probe — a new class member would ship in every app. With a
navigation pending (push, replace, pop and `start()`'s navigation zero all fill
`#pendingNavPromise`), it schedules `pending.then(again, again)` and returns null, so
`setLocale` never waits on a navigation whose `data()` or guard may be awaiting it — a
switch from a layout's `data()` on the first load therefore rebuilds once nav zero
commits. With none pending, the promise resolves on the rebuilt commit and rejects on
failure. Tests: `tests/i18n-app.test.js`.

## Mounting and transitions

The chain becomes nested keyed component vnodes through each `<Slot/>`; the WHOLE chain
is rebuilt each navigation (a survivor-only swap would be reverted by a later ancestor
re-render). The shared prefix keeps its instances; the topmost divergent view or a
changed layout is the sole animator. Missing outlets warn.

- Sequential mode awaits the old unit's out phase before commit; a failing leave hook
  is logged and the swap continues. `overlap` pins the leaver at its measured fixed rect
  and commits the entrant immediately. Mode resolution is destination-only (route
  override → incoming class field → app default). Interruptions synchronously destroy
  doomed pending-out subtrees. Enter hooks go through `#playInLogged`.
- Morph seam: `leave(oldRoot)` at out start (awaited before destroy),
  `enter(newRoot, { initial })` post-commit/pre-paint; errors logged, never wedge;
  params-only updates fire no morph hooks.
- Scroll: top on push, saved on pop, per-entry keys in sessionStorage (50-entry cap),
  anchors, custom behavior, opt-out. Failed/initial navigations don't move scroll.
- **Hybrid takeover** (D67): matching `data-puzzle-ssg` markup at navigation zero is
  replaced in the commit window, the marker removed, initial enter skipped. A failed
  takeover mount first offers the position to the error view; otherwise the snapshotted
  prerendered nodes + marker are restored
  ([[DECISION-D140-TAKEOVER-MOUNT-RESTORATION]]), and every container-mount branch re-runs
  the takeover clear. Static output (D81) has no router.
