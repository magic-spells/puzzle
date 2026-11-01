---
name: Dev performance collector
status: verified
path: client-runtime/devperf.js
language: javascript
summary: Development-only performance events, causal chains, mutation accounting, and loop protection
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - DOC-SPEC-BUILD
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# devperf.js

The dev-only performance collector ([[DECISION-D121-DEV-PERFORMANCE-PROFILING]]):
per-view profiler state in WeakMaps, causal chains, mutation accounting and loop
protection, with an event bus that `devtools.js` and `testing/render-profile.js`
attach sinks to. It knows nothing of the DevTools protocol.

Every runtime caller (`PuzzleView`, `viewManager`, `store`, `listBlock`, `portal`,
`componentSlot`) calls in only behind a positive `__PUZZLE_DEV__` guard, so
production folds the calls and tree-shakes the module; the compiler's build tests
assert that. Undefined `__PUZZLE_DEV__` (unbundled tests) counts as true.
