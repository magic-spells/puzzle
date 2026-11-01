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
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# devperf.test.js

Covers [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]: actual render-entry counts, zero-mutation (wasted) renders, bounded `data()`/store feedback loops, and the immutable `measureRenders` report from `./testing`.
