---
name: D121 — Dev-only runtime performance profiling with zero production bytes
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DOC-TESTING
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D57-HMR-STATE-RELOAD
  - FILE-DEVPERF
  - FILE-TESTING-RENDER-PROFILE
  - TEST-BUILD-AND-DEV-PIPELINE
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D121 — Dev-only runtime performance profiling with zero production bytes

[[FILE-DEVPERF]] (`client-runtime/devperf.js`) is the single dev-only render and
store profiler. It feeds `measureRenders()` in `/testing` (D94), the DevTools
profiler (D122) and the console loop warnings, and compiles to nothing in
production.

## Decision

- **One collector, no fields on runtime classes.** All per-view state and ids
  live in module WeakMaps — nothing on PuzzleView, ViewManager, Store or Router.
  It times tree construction separately from diff/patch, counts actual DOM
  writes, times `data()` and Store flushes, and counts tracking-chain deferrals,
  props bailouts, slot-only renders, memo hits/misses, and list-row and
  static-subtree cache reuse (D170). Consumers attach through a sink.
- **A render record** is an entry into `ViewManager.render`; a render with zero
  DOM mutations is a **wasted render**. A causal token follows Store
  notification → data refresh → render → writes; quiescence (not one queue
  drain) resets recursion depth.
- **Two loop guards, deliberately asymmetric:**
  - **Recursive (per causal chain) — stops.** 100 executions of one view in one
    non-quiescent chain → `console.error` (`kind: 'recursive'`) and further
    renders in that chain are suppressed. This is proof of a loop.
  - **Cross-frame (rolling second) — warns only.** ≥60 renders/second with ≥90%
    wasted and no animation/morph cause → `console.warn` (`kind: 'cross-frame'`).
    It never gates a render: reused route ancestors legitimately re-render
    several times per navigation, mostly mutating nothing, and suppressing them
    left routed children unmounted under fast clicking. `runawayUntil` is only
    the re-warn throttle. A dev instrument must not change what the app does.
- **Scopes pop on every exit.** Every pushed scope is popped on all exits, throws
  included (`#renderNow`'s dev branch calls `devperfRenderCancel` before
  rethrowing). Per-subject marks are a **LIFO stack** wherever the operation can
  re-enter — `activeStoreFlushes` (a subscriber may call `store.flush()`) and
  `activeRenders` (a ref callback or `connectedCallback` inside the render span
  can call `refresh()` with a sync `data()`). A single-slot mark leaks the outer
  scope, and the leaked chain later trips the recursion guard on legitimate
  renders.
- **Zero production bytes is a contract.** Class-method touchpoints spell
  `typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__` inline in a positive
  branch; module functions may use a module `DEV` const. No bare define reads,
  negative early-return gates, or dev-only private class members (esbuild keeps
  unreferenced private members). `TestBuildDevDefineDCE` asserts the production
  metafile attributes zero `bytesInOutput` to `devperf.js` (positive in dev) and
  that neither `__PUZZLE_PERF__` nor the bridge's profiler request strings
  survive.

## Alternatives rejected

- **Count `refresh()` calls from `/testing`** — refreshes coalesce; can't see
  wasted patches.
- **MutationObserver counting** — async; can't bracket nested renders or
  attribute writes.
- **Reset recursion per flush or rAF** — a data→write→flush loop crosses drains.
- **Cross-frame suppression with a higher threshold, or exempting route
  ancestors** — any threshold that clears legitimate churn misses real loops; a
  silently broken tree is worse than a missed warning.
- **Zero-bytes oracle = byte-identity with a pre-change build, or a recorded size
  with a tolerance band** — identity breaks on unrelated work and minifier
  identifier drift (a permanently red check gets ignored); a band wide enough for
  legitimate growth hides a real leak.
