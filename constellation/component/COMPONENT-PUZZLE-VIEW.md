---
name: PuzzleView
status: verified
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
verified_at: '2026-07-25T05:23:57.003Z'
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
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
view cannot be resubscribed by a late continuation.

Lifecycle: `created` → awaited/tracked `data` → render → `mounted`, with
`beforeUpdate`/`afterUpdate` around later patches and idempotent `destroyed`
teardown. `preload()` performs created/data off-DOM for the router, and a later
preloaded mount is synchronous. Comment anchors preserve positions while normal
async components wait. When `renderSkeleton` is defined, the `#loaded` latch
renders the skeleton while unloaded, `mounted()` fires against it, and the mount
resolves without awaiting `data()`, with an anti-flash min-duration hold before
the swap (see [[DECISION-D39-SKELETON]] / [[DECISION-D52-SKELETON-ANTIFLASH]]).

Public instance surface includes `ctx`, `props`, `route`, `element`, `refs`,
`getData`, `setData`, `refresh`, `memo`, `isDestroyed`, `playIn`, `playOut`, and
`destroyAnimated`. `this.route` is the frozen per-navigation snapshot that is
safe inside the pre-commit data gate. `memo(key, deps, factory)` compares deps
with `Object.is` and keeps reference-stable derived props.

Static `ref="name"` bindings use cached `__ref` callbacks. Replacements repoint
the ref; removals and destroy clear it. Development builds register mounted
views with [[COMPONENT-DEVSTATE]] so only JSON-safe local state crosses a live
reload.

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
