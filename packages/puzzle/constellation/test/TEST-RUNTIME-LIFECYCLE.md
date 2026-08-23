---
name: App and view lifecycle suite
kind: unit
status: built
framework: vitest
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - STATE-VIEW-LIFECYCLE
  - DOC-VIEW-LIFECYCLE
  - FLOW-REACTIVITY
  - DECISION-D15-PLAIN-CLASS-VIEW
  - DECISION-D23-REFRESH-PATTERN
  - DECISION-D39-SKELETON
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D64-MEMO-HELPER
  - DECISION-D66-APP-LIFECYCLE-HOOKS
  - DECISION-D72-ELEMENT-REFS
  - DECISION-D118-LIFECYCLE-HOOK-CONTAINMENT
  - DECISION-D136-VIEW-LIFECYCLE-CONVERGENCE
  - DECISION-D145-ERROR-BOUNDARIES
  - DOC-TESTING
---


# App and view lifecycle suite

Proves the two lifecycle owners in jsdom: [[COMPONENT-PUZZLE-APP]] construction
through unmount, and [[COMPONENT-PUZZLE-VIEW]] mount through destroy.

App side: boot order and service wiring, pre-mount store access failing loudly,
formatter and model registration, target resolution, `beforeMount` / `mounted` /
`beforeUnmount` contracts and their validation, repeated mount/unmount cycles,
and the mount-generation guard that makes an unmount landing mid-`beforeMount`
safe. The app-level `errorView` funnel is proven here too: replacement,
retry re-running the real navigation pipeline, terminal failure defaults, and
cleanup of the replaced position.

View side: the two-layer `data()` / `setData()` split, tracked store reactivity
across the full subscription loop, `refresh()`, memoized derived values,
skeleton loading with the anti-flash minimum hold, element refs across the
lifecycle, `render()` returning null clearing the mounted DOM without
disturbing the skeleton path, and teardown guards — a throwing `destroyed()`
hook must not wedge the cascade or leave the app half-unmounted.

One file in this group is a cross-cutting hardening set rather than a single
subject: it pins unified safe-assign skip sets, snapshot iteration of the
subscriber set, batched persistence in `flush()`, observed abandoned tracking
promises, refs nulled after destroy, and the `pagehide` flush.

Covers 11 files under `tests/`.
