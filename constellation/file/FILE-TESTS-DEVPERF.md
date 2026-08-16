---
name: Dev performance instrumentation tests
status: verified
path: tests/devperf.test.js
language: javascript
summary: Vitest coverage for render/mutation profiling, loop stopping, and measureRenders
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - DOC-TESTING
  - FILE-DEVPERF
  - FILE-TESTING-RENDER-PROFILE
verified_at: '2026-08-16T04:34:56.264Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Covers D121's durable behavior: actual render-entry counts, zero-mutation wasted renders, bounded data/Store feedback loops, and the public immutable `measureRenders` report.
