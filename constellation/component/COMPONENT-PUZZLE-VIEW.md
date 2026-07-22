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
verified_at: '2026-07-22T00:04:07.617Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
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

Enter/leave specs and the four show/hide hooks delegate to
[[COMPONENT-ANIMATIONS]]. Teardown catches leave-hook failures and still removes
the subtree. The compiler attaches `render()` to the prototype after the user
class and reads class-field `events` lazily at render time.
