---
name: Dev runtime performance instrumentation and render assertions
status: built
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
- Out: a production profiler, a framework config option, or new runtime class state.
- DevTools protocol exposure was originally out of scope and was added afterwards by [[DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL]].

## Acceptance

- Tree-build and diff/patch timings are distinct; every report render is an actual `ViewManager.render` entry.
- DOM mutations, props bailouts/reruns, slot renders, Store flush keys/subscribers, async tracking deferrals, and memo hits/misses are observable through the dev collector.
- A data→Store-write→data cycle reports and stops at 100 executions without hanging.
- The rolling wasted-render guard uses the 60/90%/one-second threshold, exempts animation/morph causes, warns once per window — and does **not** suppress the render. A view that trips it keeps rendering, and a later render that does change the DOM still lands.
- `measureRenders` awaits `settled()`, always detaches its sink, and returns a deeply immutable report with the contracted fields.
- The development bundle retains the devperf sentinel and a positive `bytesInOutput` contribution; production contains neither the sentinel, nor the profiler's bridge request strings, nor any attributed devperf bytes.
- The full JavaScript and Go suites plus the requested manual build checks pass.

## Current state

Shipped. The collector, both loop guards, `measureRenders`, and the public types
are in place, and [[DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL]] carries the same
data over the DevTools bridge. Two scope-lifecycle leaks that could strand a
causal chain — a throwing render, and a re-entrant `flush()` — are fixed and
pinned by regression tests; D121's gotcha note holds the invariant they taught.

Coverage is `tests/devperf.test.js` and `tests/devtools-bridge.test.js` on the
JavaScript side and `TestBuildDevDefineDCE` on the Go side, the latter proving
the sentinel split, the profiler's bridge request strings, and the metafile
`bytesInOutput` split in both directions. Both full suites pass, the earlier
`httptest` port-bind blockage included.

The byte-identity acceptance clause above is retired; D121's implementation note
records why zero attributed devperf bytes, not a remembered artifact size, is
the oracle. One item stays unchecked: the DevTools Performance panel end to end,
which D122 confirms from a real-Chrome session but which needs the published
extension and a live `puzzle dev` server to re-run — hence **built**, not
verified.
