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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D121 — Dev-only runtime performance profiling with zero production bytes

## Decision

[[FILE-DEVPERF]] (`client-runtime/devperf.js`) is the single dev-only collector.
All per-view state and ids live in module WeakMaps — no fields on PuzzleView,
ViewManager, Store or Router. It times tree construction separately from
diff/patch, counts actual DOM writes, times `data()` and Store flushes, surfaces
the Store's async tracking-chain deferrals, props bailouts, slot-only renders and
memo hits/misses. A render record is an entry into `ViewManager.render`; a zero
DOM-mutation delta is a **wasted render**. A causal token follows Store
notification → data refresh → render → writes; quiescence (not a single queue
drain) resets recursion depth.

**Two loop guards, deliberately asymmetric:**

- **Recursive (per causal chain) — stops.** 100 executions of one view in one
  non-quiescent chain → `console.error` (`kind: 'recursive'`) and further renders
  in that chain are suppressed.
- **Cross-frame (rolling second) — warns only.** ≥60 renders/second with ≥90%
  wasted and no animation/morph cause → `console.warn` (`kind: 'cross-frame'`).
  It never gates a render: reused route ancestors legitimately re-render several
  times per navigation mostly mutating nothing, so a suppressing guard broke
  nested route trees under fast clicking. `runawayUntil` is only the re-warn
  throttle. A dev instrument must not change what the app does.

`measureRenders()` in `/testing` (D94) consumes the collector through a temporary
sink.

**Scope-lifecycle invariant:** every pushed scope is popped on **all** exits,
throws included (`#renderNow`'s dev branch wraps the render span and calls
`devperfRenderCancel` before rethrowing), and per-subject mark storage is a
**LIFO stack** anywhere the operation can re-enter — `activeStoreFlushes`
(a subscriber may call `store.flush()`) and `activeRenders` (ref callbacks or
`connectedCallback` inside the render span can call `refresh()` with a sync
`data()`). A single-slot mark leaks the outer scope, and the leaked chain later
trips the recursion guard on legitimate renders.

**Zero production bytes is a contract.** Class-method touchpoints spell
`typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__` inline in a positive
branch; module functions may use a module `DEV` const; no bare define reads,
negative early-return gates, or dev-only private class members (esbuild keeps
unreferenced private members). `TestBuildDevDefineDCE` asserts the production
metafile attributes zero `bytesInOutput` to `devperf.js` (positive in dev) and
that neither `__PUZZLE_PERF__` nor the bridge's profiler request strings survive.
Byte-identity against a remembered bundle is *not* the oracle — unrelated work
moves the bundle, and dead imports can shift minified identifier allocation.

## Alternatives

- **Count `refresh()` calls from `/testing`** — refreshes coalesce; can't see
  wasted patches.
- **MutationObserver counting** — async; can't bracket nested renders or
  attribute writes.
- **Reset recursion per flush or rAF** — a data→write→flush loop crosses drains.
- **Keep cross-frame suppression with a higher threshold, or exempt route
  ancestors** — any threshold clearing legitimate churn misses real loops; a
  silently broken tree is worse than a missed warning.
- **Zero-bytes oracle = byte-identity with a pre-change build, or a recorded
  size with a tolerance band** — identity breaks on identifier-allocation drift
  and on any unrelated feature work (a permanently red oracle gets ignored); any
  band wide enough for legitimate growth hides a real leak. Stash-and-compare
  hashes stay a handy ad-hoc spot check, not the contract.
