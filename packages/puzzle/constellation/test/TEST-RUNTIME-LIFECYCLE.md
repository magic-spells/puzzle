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

Proves the two lifecycle owners in jsdom: [[COMPONENT-PUZZLE-APP]] from
construction through unmount, and [[COMPONENT-PUZZLE-VIEW]] from mount through
destroy. Suites under `tests/` include `app`, `app-lifecycle-hooks`,
`app-mount-epoch`, `error-boundaries`, `view`, `memo`, `element-refs`,
`skeleton-antiflash`, `render-null-clears-dom`, `teardown-hook-guards`,
`refresh-ownership`, `view-prepare-scope-overlap` and
`soft-launch-runtime-fixes`.

- **App:** boot order and service wiring, pre-mount store access failing loudly,
  formatter and model registration, target resolution, the `beforeMount` /
  `mounted` / `beforeUnmount` contracts and their validation, repeated
  mount/unmount cycles, and the mount-generation guard that makes an unmount
  landing mid-`beforeMount` safe. The `errorView` funnel: replacement, retry
  re-running the real navigation pipeline, terminal failure defaults, cleanup of
  the replaced position.
- **View:** the two-layer `data()` / `setData()` split, tracked store reactivity
  across the full subscription loop, `refresh()`, `memo()`, skeleton loading
  with the `min-duration` hold, element refs, `render()` returning null clearing
  the mounted DOM without disturbing the skeleton path, and teardown guards — a
  throwing `destroyed()` must not wedge the cascade or half-unmount the app.
- `soft-launch-runtime-fixes` is a cross-cutting hardening set: unified
  safe-assign skip sets, snapshot iteration of the subscriber set, batched
  persistence in `flush()`, observed abandoned tracking promises, refs nulled
  after destroy, and the `pagehide` flush.
