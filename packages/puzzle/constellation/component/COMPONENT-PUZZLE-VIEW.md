---
name: PuzzleView
status: verified
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ANIMATIONS
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - COMPONENT-DEVSTATE
  - FLOW-REACTIVITY
  - FILE-PUZZLE-VIEW
  - DECISION-D39-SKELETON
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D161-AUTO-FETCHING-FINDS
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# PuzzleView

Plain base class (views/PuzzleView.js) for every component, view and layout. It owns
state, lifecycle, tracked `data()` evaluation, refresh tokens, animations, refs and
update scheduling; [[COMPONENT-VIEW-MANAGER]] owns the DOM. The author-facing class
contract is [[DOC-SPEC-ANATOMY]] §4 and [[DOC-SPEC-VIEW]]. The internal `elementEnd` getter follows the live manager or error view to the end of a component's complete DOM range, recursively through component-root selections; `element` remains its first node.

## The per-view ctx

The constructor's one line `this.ctx = ctx.store?._deriveCtx?.(ctx, this) ?? ctx` is how
a view gets its store handle. `_deriveCtx` lives in [[COMPONENT-ADAPTER]]; with the
capability it returns a ctx whose `store` is a per-view Proxy and whose prototype is the
app ctx (so `router`, `formatters` stay live); without it the view keeps the app ctx by
identity ([[DECISION-D157-ADAPTER-SUBPATH]]). The derived ctx always chains off the BASE
ctx (two deep at any nesting). Invariants: the handle binds forwarded methods to the RAW
store ([[COMPONENT-STORE]]), and any WeakMap keyed by ctx must resolve through the
prototype chain (as `errors.js` does). Only reads through this handle, by this view,
during its own evaluation, may fault (D161).

## State and refresh

- Two layers: a successful `data(params, props)` REPLACES the model layer (omitted keys
  vanish); `setData()` writes a persistent local layer that wins until the next model
  commit and rerenders without rerunning `data()`. Keep raw local values and
  `data()`-derived display values under different keys, or the commit erases the raw
  one. Use `refresh()` when local state feeds `data()`.
- Async refresh is last-wins; a destroyed view can't be resubscribed by a late
  continuation. `prepareRefresh()` is the router's two-phase form for reused ancestors
  ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]).
- **Settle loop** ([[DECISION-D161-AUTO-FETCHING-FINDS]]): `_settleData` is installed on
  the prototype by the adapter. Core's only test, at refresh and prepareRefresh, is
  `store._a && this._settleData` — BOTH halves matter: the install is realm-wide, so a
  later no-adapter app in the same realm must be held back by its own store's `_a`
  (`tests/adapter-realm-isolation.test.js`); `_settleData` absent means the loop isn't in
  the bundle. A pass that queued fetches is not committed: await, unwind its
  subscriptions, re-run; ten rounds throw naming the view and request keys. A sync
  hit-only first pass stays sync. Mid-settle notifications coalesce into `_settleDirty`.
  A destroyed/leaving/superseded view stops after its current await (shared requests are
  not aborted); `unsubscribe()` clears the request slot but is not a latch —
  `_restoreFromLeaving()` restores faulting.
- **`onStoreChange(seq)` returns early when `seq <= _settleMark`.** The settle loop stamps
  the store's `_notifySeq` from the start of an OWNING run's committed pass (never a
  parked D146 run). A refresh started inside the store's delivery loop captures
  `Store._flushSeq` and `#commit` stamps it as a MAX — so a child that is both
  parent-updated and subscribed runs `data()` once per flush. No-argument calls never
  skip.

## Lifecycle

`created` → awaited/tracked `data` → render → `mounted`; `beforeUpdate`/`afterUpdate`
around later patches; idempotent `destroyed`. `preload()` runs created/data off-DOM
for the router, making the later mount synchronous. With `renderSkeleton`, the `#loaded`
latch renders the skeleton, `mounted()` fires against it, and the mount resolves
without awaiting `data()`, with a min-duration hold ([[DECISION-D39-SKELETON]],
[[DECISION-D52-SKELETON-ANTIFLASH]]); all settle rounds count as one load.

**Failures** ([[DECISION-D145-ERROR-BOUNDARIES]]): a contained mount/refresh failure
reports once, keeps the exact position and destroys the instance. With an app
`errorView`, a fresh view mounts there with `{ error, info, retry }`; retry is stable,
single-flight, and delegates to the Router (routed) or the parent's `refresh()`
(child). A routed retry keeps the error view up until a rebuild commits. Error-view
failures report as `phase: 'error-view'` without recursion.

A hand-written `render()` returning null clears its mounted tree and reserves the same position with a comment. Re-anchoring captures the sibling after `elementEnd`, outside the complete range even when the root is an empty or selected `<Component>`; repeated nulls reuse that position and later content remounts before trailing siblings.

## Refs and two-way binding

Static `ref="name"` uses cached `__ref` callbacks. `__bind(target, key, spec)`
([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]) is memoized like `__ref` (Map for local,
WeakMap-of-Maps for member targets) so each (target, key, spec) has one handler
identity; a primitive root gets one shared inert handler. The handler skips mid-IME
events, coerces (`v` string, `vn` number with `''` → `null` and NaN skipped, `c`
boolean), then `#bindWrite` picks: local → `setData` + `refresh`; record (duck-typed
`update` + string `_type`; this file never imports model.js) → validated `update()`;
plain object → mutate + repaint. Throws and rejections report as `phase: 'bind'`.
Two dev-only diagnostics (behind `__PUZZLE_DEV__`, never allocated in production): a
`data()` commit reverting a bound local key (`#bindPending`, value-compared so echoing
your own write stays silent), and a bound plain object replaced without the value
(`#bindMemberPending`, resolved only after the next COMPLETED render so loop order can't
false-positive).

## Internal members (never spelled in templates, reserved in SPEC §4)

- `__h`, `__ref`, `__bind` — emitter handler/ref/bind caches.
- **`__c`** — static-subtree cache, a declared field (one hidden class for every view).
  An island's children are cached only when the seed is static (D44 re-seeds on remount).
- **`__dirty`** — per-render mask over `constructor.__roots` (top-level `data()` keys a
  loop body reads), computed after `beforeUpdate()` and before `render()`. Primitives
  compare `!==`; objects/functions are always dirty; first render sets every bit; no
  `__roots` → 0. Over 31 roots wraps conservatively.
- **`__rgen`** — render counter bumped at the top of `#computeDirty`, BEFORE the
  `__roots` bail-out. A list block records it per invocation and rebuilds every row if it
  missed a render (the mask is only a per-render delta). `#makeRetry`'s component arm bumps
  the OWNER's counter before `owner.refresh()` so a failed child under a cached row is
  reached. Trees built outside `#renderNowInner` (prerender, takeover) leave it 0.
- **`__propRevs`** — snapshot of record-prop render revisions, written at mount (from
  committed props) and at each props-carrying `applyParentUpdate`; replaced wholesale,
  null when no prop has a revision.
- **`__lists`** — block registry allocated by the list block itself (on the view, or on
  the enclosing row state for nested loops).
- **No `__list` method, deliberately**: loops call `listRows` (imported as `__l`), so
  `PuzzleView` must never import `views/listBlock.js` — loop-free apps would pay ~1 KB
  gzip ([[FILE-LIST-BLOCK]]).
- Dev-tooling readers `_localState()`, `_modelState()`, `_vnodeTree()` (DevTools bridge,
  [[FILE-DEVTOOLS]]); adapter fields `_settleData`/`_settlingToken`/`_settleDirty`/
  `_settleMark`. All D121/D170 profiler state lives in [[FILE-DEVPERF]] WeakMaps;
  every class-method call site uses the inline positive `__PUZZLE_DEV__` probe.

`memo(key, deps, factory)` compares deps with `Object.is`. A store record prop needs no
memo (it compares by render revision, D170); any other object literal rebuilt per run
does. `this.route` is the frozen snapshot of the last COMMITTED navigation — an in-page
anchor move doesn't update it (read `ctx.router.current.hash`). Dev builds register
mounted views with [[COMPONENT-DEVSTATE]].
