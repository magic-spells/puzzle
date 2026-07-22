---
name: Development reload state
status: verified
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - COMPONENT-DEV-SERVER
  - DECISION-D57-HMR-STATE-RELOAD
  - FILE-DEVSTATE
  - FILE-PUZZLE-APP
  - FILE-DEV-SERVER
verified_at: '2026-07-22T01:03:38.993Z'
verified_sha: 5f16d58d1472c1c1f8f4266e9cc4c0ae40ad14d1
---

# Development reload state

Implements D57's state-preserving full reload. It is not module hot replacement: every successful dev rebuild reloads the new bundle, avoiding stale closures and partial module graphs, while a one-shot sessionStorage blob carries application state across the reload.

Immediately before `location.reload()`, the injected dev client calls `PuzzleApp.__devSnapshot()`. The snapshot stores the Store's persistence wire shape plus each mounted view's JSON-safe local state. Views are keyed by class name and per-class mount order. The filter keeps finite primitives, arrays, and plain objects; it drops functions, DOM nodes, class instances, cycles, over-depth values, and store-derived model values.

Restore is two-phase. After `beforeMount` but before navigation zero, Store records hydrate in identity-preserving replace mode so the first `data()` reads restored records. After the route chain mounts, saved local view state is applied with `setData()`. Blobs are deleted before parsing, expire after ten seconds, and every step fails soft to a cold start.

All code is guarded by the inline `__PUZZLE_DEV__` define. Production uses a constant-false branch that esbuild removes; a build regression test proves the registry, serializer, key strings, and hooks do not remain in production output.
