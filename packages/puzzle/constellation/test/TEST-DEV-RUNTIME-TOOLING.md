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
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# Dev-only runtime tooling: HMR, profiler, DevTools bridge

Three development-only surfaces that must vanish from production and stay harmless when
their host is absent. Run with
`npx vitest run tests/hmr-dev-reload tests/devperf tests/devtools-bridge`; the
production-erasure half is the Go build test `TestBuildDevDefineDCE`.

- **HMR state transfer** (`hmr-dev-reload`, [[DOC-SPEC-BUILD]] §27): snapshot and
  restore across a full reload, the two-phase restore, and the `safeState` filter that
  decides what may survive.
- **Dev performance instrumentation** (`devperf`, §56): render and store
  instrumentation, the loop detector, and `measureRenders`, a shipped helper whose report
  shape is public surface.
- **DevTools bridge** (`devtools-bridge`, §55): emitted events, request handling, the
  profiler protocol. The critical case is the negative one: with no extension hook
  installed every touchpoint is a no-op, which is what lets production DCE drop the
  module.

The DevTools extension's own suite lives in `packages/puzzle-devtools` and runs against
this working tree (`file:../puzzle`).
