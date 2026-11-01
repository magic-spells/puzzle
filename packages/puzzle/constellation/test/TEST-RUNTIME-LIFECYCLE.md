---
name: App and view lifecycle suite
kind: unit
status: verified
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
  - DECISION-D185-APP-IDLE
  - DECISION-D178-AFTERUPDATE-PREV
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# App and view lifecycle suite

The two lifecycle owners in jsdom: [[COMPONENT-PUZZLE-APP]] from construction through
unmount, and [[COMPONENT-PUZZLE-VIEW]] from mount through destroy (the machine is
[[STATE-VIEW-LIFECYCLE]]). Run with
`npx vitest run tests/app tests/error-boundaries tests/view tests/memo tests/element-refs tests/skeleton-antiflash tests/render- tests/teardown-hook-guards tests/refresh-ownership tests/soft-launch-runtime-fixes tests/component-slot`.

- **App** (`app`, `app-lifecycle-hooks`, `app-mount-epoch`): boot order and service
  wiring, pre-mount store access failing loudly, function and model registration, target
  resolution, the `beforeMount` / `mounted` / `beforeUnmount` contracts, repeated
  mount/unmount cycles, and the mount-generation guard that makes an unmount landing
  mid-`beforeMount` safe.
- **`app.idle()`** (`app-idle`, D185) and **`renderTick()`** (`render-tick`, D188) on
  the shared frame scheduler, including hidden-tab stepping.
- **`errorView`** (`error-boundaries`, D145): replacement, retry re-running the real
  navigation pipeline, terminal failure defaults, cleanup of the replaced position.
- **View** (`view`, `memo`, `element-refs`, `skeleton-antiflash`,
  `render-null-clears-dom`, `view-prepare-scope-overlap`, `refresh-ownership`): the
  two-layer `data()` / `setData()` split, tracked store reactivity across the full
  subscription loop, `refresh()` and stale-refresh ownership, `afterUpdate(prev)`,
  `memo()`, skeletons with the `min-duration` hold, element refs, `render()` returning
  null clearing the DOM without disturbing the skeleton path, `prepareRefresh` scope
  unwinding.
- **Teardown** (`teardown-hook-guards`): a throwing `destroyed()` must not wedge the
  cascade or half-unmount the app.
- **`<Component>` swaps** (`component-slot`, D180): the outgoing instance is completely
  torn down (pending async mounts and out animations included) before a new constructor
  mounts, and descendant hide hooks cannot postpone it; a same-constructor instance is
  retained. Removing a selected child through a conditional or keyed list follows
  ordinary component removal (`viewWillHide` once, leave finishes, then teardown).
- `soft-launch-runtime-fixes` is a cross-cutting hardening set: unified safe-assign skip
  sets, snapshot iteration of the subscriber set, batched persistence in `flush()`,
  observed abandoned tracking promises, refs nulled after destroy, the `pagehide` flush.
