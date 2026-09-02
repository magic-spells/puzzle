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
notes:
  - kind: gotcha
    text: >-
      Keep raw source values and data()-derived display values under different keys. A successful
      data() replaces the model layer, so reusing one key for raw local state and a reshaped model
      value loses the raw value by design.
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: state
    text: >-
      Settle-path selection is per-STORE, not per-prototype (2026-08-30). `#refreshInner` and
      `prepareRefresh` choose the D161 settle loop on `store._a && this._settleData`, not on
      `_settleData` alone. The capability install is realm-wide and permanent, so a second app
      mounted later in the same realm WITHOUT `config.adapter` used to inherit the settle path from
      the first and fault reads it had deliberately opted out of (a model carrying adapter metadata
      was enough). The `_settleData` half of the test stays: without the capability anywhere in the
      realm the loop is not in the bundle at all (D157). Regression:
      tests/adapter-realm-isolation.test.js.
  - kind: state
    text: >-
      `onStoreChange(seq)` takes the Store's batch sequence and returns early when `seq <=
      this._settleMark` (0.7.0). `_settleMark` joins `_settlingToken`/`_settleDirty` as an
      underscore-public settle field: the adapter's `_settleData` records the store's `_notifySeq`
      as of the start of each pass and stamps it onto `_settleMark` when an OWNING run's pass
      commits — never for a parked (D146 prepared) run, whose model is not on screen until commit. A
      batch at or below the mark predates the evaluation that produced the committed model, so it is
      already rendered; anything a second writer queues during that pass sorts above it and still
      refreshes. Called with no argument (the settle loop handing a folded notification back, a
      manual invocation) it never skips.
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# PuzzleView

Plain base class for every component, view, and layout. It owns state,
lifecycle, tracked `data()` evaluation, refresh tokens, animations, refs, and
update scheduling; [[COMPONENT-VIEW-MANAGER]] owns DOM operations.

The constructor is where a view acquires its store handle, in one line:
`this.ctx = ctx.store?._deriveCtx?.(ctx, this) ?? ctx`. `_deriveCtx` lives in
[[COMPONENT-ADAPTER]] beside the handle it wraps, so core carries only that
optional call. On a store with the capability it returns a ctx whose `store` is
a per-view Proxy and whose prototype is the app's ctx, keeping `router`,
`formatters` and every other field LIVE rather than snapshotted; without the
capability it returns undefined and the view keeps the app ctx itself —
`this.ctx === ctx`, `ctx.store === app.store`, identity and all
([[DECISION-D157-ADAPTER-SUBPATH]]).

That handle is the only channel through which a read may fault (D161): reads
through it, by this view, during this view's evaluation, join that evaluation's
request map; every other read in the realm is a local snapshot. The derived ctx
always chains off the BASE ctx — a nested component is constructed with its
parent's derived ctx, and re-deriving from that would add a prototype link per
level of nesting — so the chain is exactly two deep at any depth. Two
consequences a change here must preserve: the handle binds every forwarded
method to the RAW store (see [[COMPONENT-STORE]]), and any WeakMap keyed by ctx
identity must resolve through the prototype chain, which is why `errors.js`
looks the app's error config up that way. Every construction site — routed
views and layouts, components, error views, prerender, the static kernel —
reaches this one constructor and needs no code of its own.

State has two layers. A successful `data(params, props)` result replaces the
model layer, so omitted model keys disappear. `setData()` mutates a persistent
local layer that wins over model values until the next successful model commit.
It schedules a render but never reruns `data()`; call `refresh()` when local
state feeds derived model values. Async refresh is last-wins and a destroyed
view cannot be resubscribed by a late continuation. `prepareRefresh()` is the
router-internal two-phase form used for reused ancestors during a gated
navigation — it evaluates `data()` against the destination without touching
committed state and hands back commit/discard
([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]).

When THIS app's store carries the adapter capability, every tracked `data()`
evaluation runs inside the D161 settle loop — `_settleData`, installed onto the
prototype by [[COMPONENT-ADAPTER]]. Core holds only the `!store._a ||
!this._settleData` test at its two call sites — refresh and prepareRefresh;
preload, mount, and prerender all reach the loop through refresh — so
no-adapter apps ship a single-pass evaluator and none of the loop. Both halves
of that test matter: the install is realm-wide and permanent, so a later
no-adapter app in the same realm inherits the METHODS and must be held back by
its own store's capability, while the `_settleData` half is what keeps the loop
out of a bundle that never installs it. `store` at both sites is
`this.ctx.store` — the view's handle — and the proxied `withTracking` binds
back to the raw store while `subscriber === this` carries the handle context,
so the loop's own code needed no change to become attribution-aware. Each pass
carries its own
pending-request Map and held reconcile; a
pass that queued fetches is not committed — the batch is awaited, the
provisional pass's subscriptions are unwound, and `data()` re-runs, so only
the final warm pass's subscriptions and model commit
([[DECISION-D161-AUTO-FETCHING-FINDS]]). A sync, hit-only first pass stays
synchronous. Ten rounds throw through the normal data-failure path naming the
view and the round's request keys. Store notifications arriving mid-settle
coalesce into `_settleDirty` — one more pass, never a competing refresh —
while prepared (D146) runs keep their live-update behavior. A destroyed,
leaving, or superseded view stops the loop after its current await without
aborting shared requests, and its handle stops faulting the moment
`unsubscribe()` clears the request slot. That clearing is not a latch: playOut()
unsubscribes a LIVE view, and `_restoreFromLeaving()` puts it back on screen and
refreshes it, so the restored view faults exactly as before — withTracking's
restore consults `isDestroyed`, not a flag. `refresh()`,
`preload()`, and
`prepareRefresh().ready` therefore resolve only after settlement, and a
previously-sync `data()` may return a promise when it misses.

Lifecycle: `created` → awaited/tracked `data` → render → `mounted`, with
`beforeUpdate`/`afterUpdate` around later patches and idempotent `destroyed`
teardown. `preload()` performs created/data off-DOM for the router, and a later
preloaded mount is synchronous. Comment anchors preserve positions while normal
async components wait. When `renderSkeleton` is defined, the `#loaded` latch
renders the skeleton while unloaded, `mounted()` fires against it, and the mount
resolves without awaiting `data()`, with an anti-flash min-duration hold before
the swap (see [[DECISION-D39-SKELETON]] / [[DECISION-D52-SKELETON-ANTIFLASH]]).
All D161 settle rounds count as one load: the skeleton shows from the first
miss and holds through every round, and a loaded view keeps its existing
content through later settles.

Contained mount/refresh failures report once, preserve the manager's exact
position, and destroy the failed instance. With an app `errorView`, a fresh
ordinary view mounts there with `{ error, info, retry }`; retry is stable,
single-flight, and delegates to an already-owned rebuild path: the Router
forces a same-location replacement for routed instances, while a child asks
its parent to refresh so the normal D115 patch mounts a fresh child. A routed
retry keeps its error view mounted throughout, so a rebuild that never commits
leaves the face standing rather than an empty position, and the latch re-arms
whenever it does. Without
one, the comment position remains for the owner's ordinary next patch.
Error-view failures are reported as `phase: 'error-view'` and stop without
recursion. There is no per-view `errorContent` API or ancestor walk
([[DECISION-D145-ERROR-BOUNDARIES]]).

Public instance surface includes `ctx`, `props`, `params`, `route`, `element`,
`refs`, `loaded`, `getData`, `setData`, `refresh`, `memo`, `isDestroyed`,
`playIn`, `playOut`, `skipEnter`, and `destroyAnimated`. `this.ctx` is the
per-view ctx described above — the documented way to reach the store, and on an
adapter app the only way a read fetches. `this.route` is the
frozen per-navigation snapshot that is safe inside the pre-commit data gate.
`memo(key, deps, factory)` compares deps with `Object.is` and keeps
reference-stable derived props.

Static `ref="name"` bindings use cached `__ref` callbacks. Replacements repoint
the ref; removals and destroy clear it. Development builds register mounted
views with [[COMPONENT-DEVSTATE]] so only JSON-safe local state crosses a live
reload.

`__bind(target, key, spec)` is the write-back dispatch for implicit two-way
binding ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]), memoized on the same
principle as `__ref` (a Map for null-target locals, a WeakMap-of-Maps for
member targets) so patches see one stable handler identity per (target, key,
spec). A member path whose root resolves to a primitive is not writable and
degrades to a single shared inert handler rather than throwing at render. The
handler ignores mid-IME-composition events, applies the compile-time
coercion (`v` string, `vn` numeric with `''`→`null` and NaN skipped, `c`
boolean), then `#bindWrite` picks an arm at write time: local → `setData` +
`refresh`; record (duck-typed `update` + string `_type` — this file never
imports model.js) → validated `update()` with a rejected write reported through
`reportError` as `phase: 'bind'`, mutating nothing; plain object → mutate +
repaint. Both refreshing arms funnel a synchronous throw and an async rejection
into the D145 path as `phase: 'bind'`, because a bind handler is a
fire-and-forget DOM listener with no other caller.

Two dev-only diagnostics watch for writes that silently disappear, both gated
inline on `__PUZZLE_DEV__` and never allocated in production. The layer-clobber
check arms `#bindPending` before the local arm's refresh and, at the tail of
`#recompose`, warns once per key (`#bindWarned`) when a `data()` commit reverts
a bound local key — the value compare keeps the legitimate read-own-write echo
idiom silent. The rebuilt-target check arms `#bindMemberPending` on the
plain-object arm and resolves it at the tail of the next completed render:
`__bind` records which member objects that render actually used
(`#bindMemberLast`), and the warning (`#bindMemberWarned`, once per key) fires
only when the written object never returned, exactly one unambiguous
replacement did, and that replacement did not preserve the value. The
completed-render fence is what keeps a loop's ordinary traversal order from
false-positiving; record writes never arm it, so store-record replacement stays
silent.

D121 adds development-only attribution around `data()`, render-tree
construction, patching, memo, slot-only updates, and scheduled causes. All
profiler state remains in [[FILE-DEVPERF]] WeakMaps: PuzzleView has no profiler
field or private helper, and every class-method call site uses the inline
positive `__PUZZLE_DEV__` probe required for production DCE.

Two underscore-prefixed **internal** readers exist for dev tooling and are not
public API (never spelled in a template): `_modelState()` returns just the model
layer — the DevTools bridge shows the two state layers separately, so the merged
`getData()` will not do — and `_vnodeTree()` returns this instance's current
vnode tree, which the bridge walks to find child instances and so build the live
component forest without reaching into Router privates ([[FILE-DEVTOOLS]],
D100). `_localState()` predates them and serves the same convention.
`_settleData`/`_settlingToken`/`_settleDirty` follow the same underscore
convention — internal, adapter-installed, never author-facing.

Enter/leave specs and the four show/hide hooks delegate to
[[COMPONENT-ANIMATIONS]]. Teardown catches leave-hook failures and still removes
the subtree, and the `destroyed()` hook itself is guarded — a throw is logged
and never wedges the surrounding cascade (parent destroys, `Router.stop()`,
`PuzzleApp.unmount()`; D118). A hand-written `render()` returning null after a
tree clears the DOM and re-anchors its position — compiled templates always
emit a root, so this is authored-view territory (D118). The compiler attaches
`render()` to the prototype after the user class and reads class-field `events`
lazily at render time.
