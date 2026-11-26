---
name: Dev performance instrumentation tests
status: verified
path: tests/devperf.test.js
language: javascript
summary: Vitest coverage for render/mutation profiling, loop stopping, and measureRenders
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DOC-TESTING
  - FILE-DEVPERF
  - FILE-TESTING-RENDER-PROFILE
  - TEST-DEV-RUNTIME-TOOLING
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# devperf.test.js

Covers [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]: actual render-entry counts, zero-mutation (wasted) renders, bounded `data()`/store feedback loops, and the immutable `measureRenders` report from `./testing`.
