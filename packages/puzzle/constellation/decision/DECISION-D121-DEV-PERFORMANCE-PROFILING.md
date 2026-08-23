---
name: D121 — Dev-only runtime performance profiling with zero production bytes
status: verified
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
verified_at: '2026-08-16T04:35:03.476Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
notes:
  - kind: gotcha
    text: >-
      Two scope-lifecycle leaks found and fixed in the pre-release review (fix/prerelease-review):
      (1) a throwing render()/renderSkeleton()/patch skipped devperfRenderEnd, stranding the
      prepared mark's scope on activeScopes — the chain never quiesced and every later render piled
      onto it until canRenderImpl's recursion guard suppressed LEGITIMATE renders (reproduced: one
      throwing template froze an unrelated view at render #101). #renderNow's dev branch now wraps
      the render span in try/catch → devperfRenderCancel (which had been exported with zero callers)
      → rethrow; production folds the wrapper out. (2) activeStoreFlushes held ONE mark per store,
      but public flush() is reentrant (a subscriber may call store.flush() synchronously): the inner
      flush overwrote the outer mark and its end deleted it, so the outer scope leaked identically.
      Now a per-store LIFO stack; the notified-counter targets the top. The invariant to preserve in
      future instrumentation: every pushScope must be popped on ALL exits including throws, and any
      single-slot per-subject mark storage is wrong wherever the instrumented operation can
      re-enter.
    sha: ed27cae
  - kind: gotcha
    text: >-
      activeRenders was the last single-slot violation of that invariant, and the earlier "no
      reentry path" refutation traced only framework-internal #renderNow callers. The real door is
      user code INSIDE the render span — ref callbacks and connectedCallback on subtree insert —
      calling refresh(), which with a sync data() renders synchronously. Now a per-view LIFO stack
      mirroring activeStoreFlushes; renderTreeBuilt/renderStart peek the innermost mark, renderEnd
      pops it.
    sha: 93f548c
---

# D121 — Dev-only runtime performance profiling with zero production bytes

## Context

Puzzle can coalesce refresh requests, but it has no way to distinguish useful renders from render entries that make no DOM writes, split render-function cost from diff/patch cost, or expose the Store's intentionally serialized async tracking queue. Feedback loops are bounded only by the testing helper's fixed-point cap; a live dev tab can still churn indefinitely. Any runtime probe is unacceptable if it changes the production bundle: the existing `__PUZZLE_DEV__` define and esbuild syntax folding already provide a measured zero-byte path for devstate and DevTools.

## Decision

Add [[FILE-DEVPERF]] as the single dev-only collector. All per-view state and ids live in module WeakMaps; no fields are added to PuzzleView, ViewManager, Store, or Router. Instrument tree construction separately from ViewManager diff/patch, count actual DOM writes, time `data()` and Store flushes, surface async tracking-chain deferral count/time, props bailouts, slot-only renders, and memo hits/misses. Render records are emitted only for entries into `ViewManager.render`; a zero DOM-mutation delta is a wasted render.

A causal token follows Store notification → view data refresh → render → writes/scheduled work. Quiescence, not an individual queue drain, resets recursive depth.

Two loop guards ride that token, and they are deliberately **asymmetric — one stops, one only warns**:

- **Recursive (per causal chain) — stops.** At 100 executions of one view inside a single non-quiescent chain the view is reported (`console.error`, event `kind: 'recursive'`) and its further renders in that chain are suppressed. 100 executions in one causal chain *is* an infinite loop; stopping it instead of hanging the tab is the whole point of the guard.
- **Cross-frame (rolling one second) — warns only.** A view that renders at least 60 times in a rolling second with at least 90% of those renders making zero DOM mutations, and no recorded cause being animation or morph work, is reported (`console.warn`, event `kind: 'cross-frame'`) and nothing else happens. This guard never gates a render.

The asymmetry is the correction of a real defect, not a nicety. The cross-frame threshold is a *heuristic about waste*, not proof of a loop, and ordinary framework behaviour reaches it: this decision's own measurements established that a route ancestor renders `depth + 2` times per navigation and that most of those renders legitimately mutate nothing, so a five-level nested route tree crosses 60-renders-per-second at roughly `60 / (depth + 2)` ≈ **8.6 navigations per second** — a developer clicking quickly through a nested app. While the guard suppressed renders, that tripped ancestor stopped re-rendering its `<Slot/>`, the routed child never mounted, and the tree stayed broken until the next navigation, with a warning that read as a diagnosis rather than an admission that the profiler had intervened. A development-only instrument must not change what the app does.

`runawayUntil` survives as the guard's **re-warn throttle only** — one warning per rolling window instead of one per frame — and no longer feeds the render gate. The emitted event keeps its `kind: 'cross-frame'` payload shape (the D122 bridge maps it to `perf-warning` for the published extension); only the human-readable text changed, to describe the waste rather than claim a stoppage.

Extend D94/SPEC §53 with runner-neutral `measureRenders(handle, callback)` in [[FILE-TESTING-RENDER-PROFILE]]. It installs a temporary collector sink, awaits the callback and the existing fixed-point `settled()`, detaches in `finally`, and returns a deeply frozen report: renders, wasted renders, DOM mutations, per-view counts, causes, maximum recursive depth, and Store notifications.

Zero production bytes is a contract, not an optimization hope. Every class-method touchpoint spells `typeof __PUZZLE_DEV__ === 'undefined' || __PUZZLE_DEV__` inline in a positive branch; module-scope functions may use a module `DEV` constant. No bare define reads, negative early-return gates, or dev-only private class methods/fields. The build test must prove the module's sentinel is retained in development, absent in production, and that esbuild's production metafile attributes zero `bytesInOutput` to `client-runtime/devperf.js`.

## Alternatives rejected

- Patch `refresh()` from `/testing` and count calls: refreshes coalesce, so it overstates renders and cannot identify wasted patches.
- MutationObserver-based counting: delivery is asynchronous, cannot reliably bracket nested component renders, and misses the source-level write attribution needed for causal reports.
- Add profiler fields or private methods to runtime classes: esbuild retains unreferenced private class members, silently violating the zero-byte contract.
- Reset recursion at each Store flush or rAF drain: a data→write→flush loop crosses drains, so that reset makes the detector ineffective.
- Keep the cross-frame guard suppressing and simply raise its threshold: any limit high enough to clear legitimate route-ancestor churn is too high to catch a real rAF-driven loop promptly, and the cost of being wrong (a silently broken route tree the developer cannot attribute) is far worse than a missed warning.
- Exempt route ancestors from the cross-frame guard: the collector would have to recognise router-owned views, and the guard would still be wrong for any other view that is legitimately busy without mutating.
- Make `measureRenders` framework-runner-specific: D94 deliberately keeps the published testing subpath independent of Vitest/Jest.

## Consequences

Development builds gain enough attribution to find wasted work and Store head-of-line blocking, plus bounded recursion protection. Cross-frame waste is *surfaced, not policed*: a genuine rAF-driven render loop in development now warns and keeps looping, bounded only by whatever the app itself does about it, which is the same situation production has always been in. That is the accepted price of never letting the profiler break a running app. Production output carries no profiler bytes at all. The instrumentation contract is coupled to build-level DCE assertions so a missed call-site guard fails the Go suite instead of shipping silently.

Implementation note: the zero-byte contract is enforced as *zero attributed
devperf bytes*, not as byte-identity against a remembered artifact. Identity was
the wrong oracle, for two reasons that both showed up in practice.

First, esbuild can attribute zero output bytes to `devperf.js` while dead
imported bindings still perturb global minified identifier allocation, so raw
length and gzip length can disagree about an unchanged module — an early
production reading sat four bytes under the pre-D121 gzip baseline at unchanged
raw length, which was that effect and never retained instrumentation. Second,
and load-bearing: unrelated runtime and example work legitimately moves the
bundle, so any remembered figure drifts and then reads as a profiler regression
when the profiler contributed nothing to it.

The enforced invariant is therefore that esbuild's production metafile
attributes zero `bytesInOutput` to `client-runtime/devperf.js` (positive in
development), and that neither the `__PUZZLE_PERF__` sentinel nor the profiler's
bridge request strings survive into production. `TestBuildDevDefineDCE` asserts
every part of that, so a missed call-site guard fails the Go suite rather than
shipping.
