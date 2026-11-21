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
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# devperf.test.js

Covers [[DECISION-D121-DEV-PERFORMANCE-PROFILING]]: actual render-entry counts, zero-mutation (wasted) renders, bounded `data()`/store feedback loops, and the immutable `measureRenders` report from `./testing`.
