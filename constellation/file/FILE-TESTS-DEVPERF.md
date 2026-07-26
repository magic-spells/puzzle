---
name: Dev performance instrumentation tests
status: built
path: tests/devperf.test.js
language: javascript
summary: Vitest coverage for render/mutation profiling, loop stopping, and measureRenders
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - DOC-TESTING
  - FILE-DEVPERF
  - FILE-TESTING-RENDER-PROFILE
---

Covers D121's durable behavior: actual render-entry counts, zero-mutation wasted renders, bounded data/Store feedback loops, and the public immutable `measureRenders` report.
