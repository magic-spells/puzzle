---
name: 'Dev-only runtime tooling: HMR, profiler, DevTools bridge'
kind: integration
status: verified
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
  - DOC-SPEC-BUILD
  - DOC-TESTING
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Dev-only runtime tooling: HMR, profiler, DevTools bridge

Three development-only surfaces that must vanish from production and stay
harmless when their host is absent. Suites: `tests/hmr-dev-reload.test.js`,
`tests/devperf.test.js`, `tests/devtools-bridge.test.js`; the production-erasure
half is the Go build test `TestBuildDevDefineDCE`.

- **HMR state transfer** ([[DOC-SPEC-BUILD]] §27): snapshot and restore across a
  full reload, the two-phase restore, and the `safeState` filter that decides
  what may survive.
- **Dev performance instrumentation** (§56): render and store instrumentation,
  the loop detector, and `measureRenders` — a shipped helper, so its report shape
  is public surface, not an internal probe.
- **DevTools bridge** (§55): emitted events, request handling, and the profiler
  protocol. The critical case is the negative one: with no extension hook
  installed every touchpoint is a no-op, which is what lets production DCE drop
  the module entirely.
