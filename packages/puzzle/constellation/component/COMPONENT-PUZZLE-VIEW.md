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
  - DOC-VIEW-LIFECYCLE
  - FILE-PUZZLE-VIEW
  - DECISION-D39-SKELETON
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D178-AFTERUPDATE-PREV
  - DECISION-D188-TICK
verified_at: '2026-11-01T19:26:46.557Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# PuzzleView

`views/PuzzleView.js` is the one plain base class for components, views and
layouts. It owns state, lifecycle, tracked `data()` evaluation, refresh tokens,
animations, refs and update scheduling; [[COMPONENT-VIEW-MANAGER]] owns the DOM.
Author contract: [[DOC-SPEC-ANATOMY]] §4 and [[DOC-SPEC-VIEW]]. States and
triggers: [[DOC-VIEW-LIFECYCLE]] §3 and §5.

## The per-view ctx

The constructor line `this.ctx = ctx.store?._deriveCtx?.(ctx, this) ?? ctx` is how
a view gets its store handle. `_deriveCtx` lives in [[COMPONENT-ADAPTER]]: with
the capability it returns a ctx whose `store` is a per-view Proxy and whose
prototype is the app ctx (so `router`, `formatters`, `idle` stay live); without
it the view keeps the app ctx by identity ([[DECISION-D157-ADAPTER-SUBPATH]]). The
derived ctx always chains off the base ctx. Any WeakMap keyed by ctx must resolve
through the prototype chain (as `errors.js` does). Only reads through this
handle, by this view, during its own evaluation, may fault
([[DECISION-D161-AUTO-FETCHING-FINDS]]).

## State and refresh

- Two layers: a successful `data(params, props)` REPLACES the model layer;
  `setData()` writes a persistent local layer that wins until the next model
  commit and rerenders without rerunning `data()`. Keep raw local values and
  `data()`-derived display values under different keys, or the commit erases the
  raw one.
- A `setData()` render goes through `schedule()` in `scheduler.js` (the shared
  [[DECISION-D63-HIDDEN-TAB-FLUSH]] frame rule). A render that lands first clears
  the flag, so the later frame is a no-op. `renderTick()` returns that module's
  `tick()`: it resolves once no store flush or view render is pending anywhere in
  the runtime ([[DECISION-D188-TICK]]).
- Async refresh is last-wins; a destroyed view can't be resubscribed by a late
  continuation. `prepareRefresh()` is the router's two-phase form for reused
  ancestors ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]).
- **Settle loop gate.** The adapter installs `_settleData` on the prototype
  (realm-wide). Core enters the loop only when `store._a && this._settleData`:
  both halves matter, because a later no-adapter app in the same realm must be
  held back by its own store (`tests/adapter-realm-isolation.test.js`). The loop
  itself (round cap, fault-in, supersession) is [[COMPONENT-ADAPTER]].
- **`onStoreChange(seq)` returns early when `seq <= _settleMark`.** A refresh
  started inside the store's delivery loop captures `Store._flushSeq`, and
  `#commit` stamps it as a max with the settle loop's `_notifySeq` mark. So a child
  that is both parent-updated and subscribed runs `data()` once per flush.
  No-argument calls never skip.
- `afterUpdate(prev)` ([[DECISION-D178-AFTERUPDATE-PREV]]): `#renderNowInner`
  freezes `{ props, params, route, data }` as each render lands (`data` is a
  shallow copy) and hands the previous one to the next update. Skipped entirely
  unless the class overrides `afterUpdate`.

## Lifecycle and failures

`preload()` runs `created`/`data` off-DOM for the router, so the later mount is
synchronous. With `renderSkeleton`, the `#loaded` latch renders the skeleton,
`mounted()` fires against it, and the mount resolves without awaiting `data()`,
with an optional min-duration hold ([[DECISION-D39-SKELETON]],
[[DECISION-D52-SKELETON-ANTIFLASH]]); all settle rounds count as one load.

A contained mount/refresh failure reports once, keeps the exact position and
destroys the instance ([[DECISION-D145-ERROR-BOUNDARIES]]). With an app
`errorView`, a fresh view mounts there with `{ error, info, retry }`. Retry is
stable and single-flight, and delegates to the Router (routed) or the parent's
`refresh()` (child). A component retry sets `owner.__walk` first, so the owner's
next patch walks reused vnodes down to the destroyed child.

A hand-written `render()` returning null clears its tree and holds the position
with a comment, anchored after `elementEnd` (the end of the component's complete
DOM range, through `<Component>` roots); `element` is the first node. `__moveTo`
relocates a live instance when a conditional routed outlet parks or adopts it.
Destruction releases pinned routed children even for a preloaded owner with no
manager.

## Refs and two-way binding

`ref="name"` uses cached `__ref` setters. `__bind(target, key, spec)`
([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]) is memoized the same way, so each
(target, key, spec) has one handler identity. The handler skips mid-IME events,
coerces (`v` string, `vn` number with `''` → `null` and NaN skipped, `c` boolean),
then writes: local → `setData` + `refresh`; record (duck-typed `update` + string
`_type`; this file never imports model.js) → validated `update()`; plain object →
mutate + repaint. Failures report as `phase: 'bind'`. Two dev-only diagnostics:
a `data()` commit reverting a bound local key, and a bound plain object replaced
without the value (checked only after the next completed render).

## Internal members

All are reserved by [[DOC-SPEC-ANATOMY]] §4 and never spelled in templates.

- `__h`, `__ref`, `__bind`: emitter handler, ref and bind caches.
- `__c`: static-subtree cache, a declared field (one hidden class per view). An
  island's children are cached only when the seed is static.
- `__dirty`: per-render mask over `constructor.__roots` (top-level `data()` keys a
  loop body reads), computed after `beforeUpdate()` and before `render()`.
  Primitives compare `!==`; objects and functions are always dirty; the first
  render sets every bit. The compiler caps `__roots` at 31.
- `__rgen`: render counter, bumped before the `__roots` bail-out. A list block
  rebuilds every row if it missed a render. Trees built outside
  `#renderNowInner` (prerender, takeover) leave it 0.
- `__walk`: one-shot "walk, don't short-circuit" flag set after a child mount
  failure or by a retry; the next render consumes it.
- `__propRevs`: record-prop render revisions, written at mount and at each
  props-carrying `applyParentUpdate`; null when no prop has one.
- `__lists`: list-block registry, allocated by the block itself.
- **No list method on the class, deliberately**: loops call `listRows` (imported
  as `__l`), and `PuzzleView` must never import `views/listBlock.js`, or loop-free
  apps pay for it ([[FILE-LIST-BLOCK]]).
- Dev readers `_localState()`, `_modelState()`, `_vnodeTree()` serve the DevTools
  bridge ([[FILE-DEVTOOLS]]); profiler state lives in [[FILE-DEVPERF]] WeakMaps
  behind inline `__PUZZLE_DEV__` probes. Dev builds register mounted views with
  [[COMPONENT-DEVSTATE]].

`memo(key, deps, factory)` compares deps with `Object.is`. `this.route` is the
frozen snapshot of the last committed navigation; an in-page anchor move doesn't
update it (read `ctx.router.current.hash`).
