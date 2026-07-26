---
name: Dev runtime performance instrumentation and render assertions
status: building
branch: perf/devperf
connections:
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - DOC-SPEC-BUILD
  - DOC-TESTING
  - FILE-DEVPERF
  - FILE-TESTING-RENDER-PROFILE
  - FILE-TESTS-DEVPERF
---

# Dev runtime performance instrumentation and render assertions

Puzzle needs actionable development-time render attribution without paying a production byte. Implement [[DECISION-D121-DEV-PERFORMANCE-PROFILING]] across the view, DOM patch, Store, and public testing surfaces.

## Scope

- In: dev-only timings/counters, mutation-backed wasted render detection, causal chains, bounded same-chain and rolling-frame loop guards, runner-neutral `measureRenders`, public types, DCE metafile proof, focused Vitest coverage.
- Out: a production profiler, a framework config option, DevTools protocol changes, or new runtime class state.

## Acceptance

- Tree-build and diff/patch timings are distinct; every report render is an actual `ViewManager.render` entry.
- DOM mutations, props bailouts/reruns, slot renders, Store flush keys/subscribers, async tracking deferrals, and memo hits/misses are observable through the dev collector.
- A data→Store-write→data cycle reports and stops at 100 executions without hanging; rolling wasted-render runaway uses the 60/90%/one-second threshold and exempts animation/morph causes.
- `measureRenders` awaits `settled()`, always detaches its sink, and returns a deeply immutable report with the contracted fields.
- The development bundle retains the devperf sentinel; production contains neither the sentinel nor attributed devperf bytes, and the canonical todos production app.js hash/gzip size remain unchanged.
- The full JavaScript and Go suites plus the requested manual build checks pass.

## Current verification gap

The implementation and JavaScript coverage are present, and
`TestBuildDevDefineDCE` proves the sentinel split plus zero production
`bytesInOutput` from `devperf.js`. This feature remains **building** because the
canonical todos artifact is not byte-identical: the pre-D121 gzip baseline in
this worktree is 20,829 bytes and the current output is 20,825 bytes (raw length
unchanged). The full Go run is also sandbox-blocked where three existing
`httptest` suites attempt local port binds.
