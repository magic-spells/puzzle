---
name: PuzzleView
status: built
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ANIMATIONS
  - COMPONENT-STORE
  - COMPONENT-DEVSTATE
  - FLOW-REACTIVITY
  - FILE-PUZZLE-VIEW
  - DECISION-D39-SKELETON
  - DECISION-D52-SKELETON-ANTIFLASH
notes:
  - kind: gotcha
    text: >-
      Keep raw source values and data()-derived display values under different
      keys. A successful data() replaces the model layer, so reusing one key for
      raw local state and a reshaped model value loses the raw value by design.
---

# PuzzleView

Plain base class for every component, view, and layout. It owns state,
lifecycle, tracked `data()` evaluation, refresh tokens, animations, refs, and
update scheduling; [[COMPONENT-VIEW-MANAGER]] owns DOM operations.

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

Lifecycle: `created` → awaited/tracked `data` → render → `mounted`, with
`beforeUpdate`/`afterUpdate` around later patches and idempotent `destroyed`
teardown. `preload()` performs created/data off-DOM for the router, and a later
preloaded mount is synchronous. Comment anchors preserve positions while normal
async components wait. When `renderSkeleton` is defined, the `#loaded` latch
renders the skeleton while unloaded, `mounted()` fires against it, and the mount
resolves without awaiting `data()`, with an anti-flash min-duration hold before
the swap (see [[DECISION-D39-SKELETON]] / [[DECISION-D52-SKELETON-ANTIFLASH]]).

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

Public instance surface includes `ctx`, `props`, `route`, `element`, `refs`,
`getData`, `setData`, `refresh`, `memo`, `isDestroyed`, `playIn`, `playOut`, and
`destroyAnimated`. `this.route` is the frozen per-navigation snapshot that is
safe inside the pre-commit data gate. `memo(key, deps, factory)` compares deps
with `Object.is` and keeps reference-stable derived props.

Static `ref="name"` bindings use cached `__ref` callbacks. Replacements repoint
the ref; removals and destroy clear it. Development builds register mounted
views with [[COMPONENT-DEVSTATE]] so only JSON-safe local state crosses a live
reload.

`__bind(target, key, spec)` is the write-back dispatch for implicit two-way
binding ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]), memoized on the same
principle as `__ref` (a Map for null-target locals, a WeakMap-of-Maps for
member targets) so patches see one stable handler identity per (target, key,
spec). The handler ignores mid-IME-composition events, applies the compile-time
coercion (`v` string, `vn` numeric with `''`→`null` and NaN skipped, `c`
boolean), then `#bindWrite` picks an arm at write time: local → `setData` +
`refresh`; record (duck-typed `update` + string `_type` — this file never
imports model.js) → validated `update()` with a rejected write reported through
`reportError` as `phase: 'bind'`, mutating nothing; plain object → mutate +
repaint. A dev-only diagnostic arms `#bindPending` before the refresh and, at
the tail of `#recompose`, warns once per key (`#bindWarned`) when a `data()`
commit reverts a bound local key — the value compare keeps the legitimate
read-own-write echo idiom silent. Every touchpoint gates inline on
`__PUZZLE_DEV__`.

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

Enter/leave specs and the four show/hide hooks delegate to
[[COMPONENT-ANIMATIONS]]. Teardown catches leave-hook failures and still removes
the subtree, and the `destroyed()` hook itself is guarded — a throw is logged
and never wedges the surrounding cascade (parent destroys, `Router.stop()`,
`PuzzleApp.unmount()`; D118). A hand-written `render()` returning null after a
tree clears the DOM and re-anchors its position — compiled templates always
emit a root, so this is authored-view territory (D118). The compiler attaches
`render()` to the prototype after the user class and reads class-field `events`
lazily at render time.
