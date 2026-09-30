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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Covers D121's durable behavior: actual render-entry counts, zero-mutation wasted renders, bounded data/Store feedback loops, and the public immutable `measureRenders` report.
