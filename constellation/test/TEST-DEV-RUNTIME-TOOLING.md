---
name: 'Dev-only runtime tooling: HMR, profiler, DevTools bridge'
kind: integration
status: built
framework: vitest
connections:
  - COMPONENT-DEVSTATE
  - FILE-DEVSTATE
  - FILE-DEVTOOLS
  - FILE-DEVPERF
  - FILE-TESTS-DEVPERF
  - FILE-TESTS-HMR-DEV-RELOAD-TEST
  - FILE-TESTING-RENDER-PROFILE
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D100-DEVTOOLS-BRIDGE
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL
  - FEATURE-HMR
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - DOC-TESTING
---


# Dev-only runtime tooling: HMR, profiler, DevTools bridge

Three development-only surfaces that must be invisible in production and
harmless when their host is absent.

HMR state transfer: snapshot and restore across a full reload, the two-phase
restore, and the `safeState` filter that decides what is allowed to survive.

Dev performance instrumentation: render and store instrumentation, the loop
detector, and `measureRenders` — which is also a shipped helper, so its report
shape is part of the public surface, not just an internal probe.

The DevTools bridge: emitted events, request handling, and the profiler
protocol. The critical case is the negative one — with no extension hook
installed every touchpoint is a no-op, which is what allows production dead-code
elimination to remove the module entirely.

Covers 3 files under `tests/`.
