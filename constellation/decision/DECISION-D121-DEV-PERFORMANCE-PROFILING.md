---
name: D121 — Dev-only runtime performance profiling with zero production bytes
status: building
connections:
  - FEATURE-DEV-PERFORMANCE-PROFILING
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-STORE
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DOC-TESTING
  - DECISION-D94-TESTING-EXPORT
  - FILE-DEVPERF
  - FILE-TESTING-RENDER-PROFILE
---

# D121 — Dev-only runtime performance profiling with zero production bytes

## Context

Puzzle can coalesce refresh requests, but it has no way to distinguish useful renders from render entries that make no DOM writes, split render-function cost from diff/patch cost, or expose the Store's intentionally serialized async tracking queue. Feedback loops are bounded only by the testing helper's fixed-point cap; a live dev tab can still churn indefinitely. Any runtime probe is unacceptable if it changes the production bundle: the existing `__PUZZLE_DEV__` define and esbuild syntax folding already provide a measured zero-byte path for devstate and DevTools.

## Decision

Add [[FILE-DEVPERF]] as the single dev-only collector. All per-view state and ids live in module WeakMaps; no fields are added to PuzzleView, ViewManager, Store, or Router. Instrument tree construction separately from ViewManager diff/patch, count actual DOM writes, time `data()` and Store flushes, surface async tracking-chain deferral count/time, props bailouts, slot-only renders, and memo hits/misses. Render records are emitted only for entries into `ViewManager.render`; a zero DOM-mutation delta is a wasted render.

A causal token follows Store notification → view data refresh → render → writes/scheduled work. One view is stopped and reported after 100 executions in one non-quiescent chain. A separate rolling-second guard stops/reports a view at 60 renders with at least 90% wasted renders when the cause is not animation or morph work. Quiescence, not an individual queue drain, resets recursive depth.

Extend D94/SPEC §53 with runner-neutral `measureRenders(handle, callback)` in [[FILE-TESTING-RENDER-PROFILE]]. It installs a temporary collector sink, awaits the callback and the existing fixed-point `settled()`, detaches in `finally`, and returns a deeply frozen report: renders, wasted renders, DOM mutations, per-view counts, causes, maximum recursive depth, and Store notifications.

Zero production bytes is a contract, not an optimization hope. Every class-method touchpoint spells `typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__` inline in a positive branch; module-scope functions may use a module `DEV` constant. No bare define reads, negative early-return gates, or dev-only private class methods/fields. The build test must prove the module's sentinel is retained in development, absent in production, and that esbuild's production metafile attributes zero `bytesInOutput` to `client-runtime/devperf.js`. The canonical todos production bundle must remain byte-identical.

## Alternatives rejected

- Patch `refresh()` from `/testing` and count calls: refreshes coalesce, so it overstates renders and cannot identify wasted patches.
- MutationObserver-based counting: delivery is asynchronous, cannot reliably bracket nested component renders, and misses the source-level write attribution needed for causal reports.
- Add profiler fields or private methods to runtime classes: esbuild retains unreferenced private class members, silently violating the zero-byte contract.
- Reset recursion at each Store flush or rAF drain: a data→write→flush loop crosses drains, so that reset makes the detector ineffective.
- Make `measureRenders` framework-runner-specific: D94 deliberately keeps the published testing subpath independent of Vitest/Jest.

## Consequences

Development builds gain enough attribution to find wasted work and Store head-of-line blocking, plus bounded loop protection. Production output remains exactly the pre-D121 bytes. The instrumentation contract is coupled to build-level DCE assertions so a missed call-site guard fails the Go suite instead of shipping silently.

Implementation note: esbuild can attribute zero output bytes to `devperf.js`
while dead imported bindings still perturb global minified identifier
allocation. The current building state demonstrates that distinction: raw
production length is unchanged but gzip is four bytes below the pre-D121
baseline, so the strict artifact-identity consequence is not yet satisfied.
