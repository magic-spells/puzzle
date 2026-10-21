---
name: D185 — app.idle
status: built
connections:
  - FEATURE-APP-IDLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC-ANATOMY
  - DOC-TESTING
  - DOC-RELEASE-SURFACE
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D63-HIDDEN-TAB-FLUSH
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D182-NAVIGATION-RESULT
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D175-TRANSLATIONS
---

## Context

Code driving a running app from outside (an agent bridge, an end-to-end script, a demo recorder) needs to know when the app has finished reacting. `router.push()` resolves when its navigation lands (D182), but a store write, a `setData()`, an async `data()`, an auto-fetching find (D161) or a locale switch (D175) has no promise anyone can hold. Drivers polled the DOM on a timer. The testing module's `settled()` (D94) answers the question for tests, but it monkey-patches `PuzzleView` and router prototypes on first use and forces flushes, which production must never do.

## Decision


`app.idle({ timeout = 10000 })` returns a promise of a boolean. It resolves `true` once two consecutive checks, one frame apart, find all of these clear:

- no `mount()` in flight (the app's own `#mountPromise`);
- no navigation in flight: the router's `#pendingNavPromise`, read through `navigating(router)`, a module-level function bound in Router's static block, so no public member is added;
- no scheduled store flush (`_flushScheduled`, which every pending notification and batched persist arms);
- no store flush or view render job waiting for its frame: `scheduled()`, the reader of the scheduler's existing pending count (the one `renderTick()` waits on, D188). idle's own checks use `frame()`, not `schedule()`, so they never count themselves. This is what catches a render chain, an `afterUpdate()` that schedules another render every frame;
- no async `data()` evaluation running (`_asyncTrackingChain`, which serializes them);
- no `setLocale()` switch loading: the i18n service's internal `__busy` flag, set when a switch starts its fetch and cleared when the switch that owns the latest token settles (its re-render included), or by a same-locale no-op that overtakes it, or at dispose. The read sits behind `__PUZZLE_HAS_I18N__`, so an app without translations ships none of it;
- on adapter apps, no tracked find's fetch in flight: `store._reading?.()`, a method the adapter installs that reads its existing per-store read state (`one`/`many` in-flight maps). A no-adapter app ships only the optional call site.

A view mid-settle is covered by the fetch and `data()` reads: between fetch rounds it is either awaiting a request in the read state or re-running `data()`, and the microtask gaps between them fall inside a frame.

The rule is **no per-operation bookkeeping**: idle reads state the runtime already keeps. The i18n flag is the one addition, and it fits the rule: it is one boolean per locale switch — a rare, user-initiated event — not a counter on any hot path.

Each check runs after its frame's callbacks (rAF, then a 0 ms timer). Frames follow the D63 scheduler in `client-runtime/scheduler.js`, shared with store flushes, view renders and `renderTick()`: one 0 ms timer per check in a hidden tab, and a 220 ms fallback timer beside each rAF, cleared when the frame wins, in case the tab hides mid-wait. A view's `setData()` render uses the same scheduler, so it lands in a background tab.

It never rejects. A timeout that is not a finite number ≥ 0 falls back to 10000 in every build (otherwise `NaN` or `Infinity` would never time out); development also logs an error. An app neither mounted nor mounting (never mounted, or after `unmount()`) resolves `true` at once; an unmount mid-wait resolves `true` at the next check. A `mount()` that never settles (the D177 first-visit redirect) times out `false`. `timeout: 0` resolves `false` unless nothing is mounted.

## Alternatives rejected


- **Reuse `settled()`** — it patches prototypes and forces flushes; production must observe, not drive.
- **Per-operation counters (pending fetches, pending writes)** — new bookkeeping on hot paths for a diagnostic API. Pending renders need none: the scheduler already counts them for `renderTick()`.
- **Read each view's private `#updateScheduled`** — there is no registry of live view instances to walk without adding one; the scheduler's pending count covers the same renders.
- **A public `router.navigating` getter** — public surface for an internal question; the static-block accessor costs a few bytes and no API.
- **Reject on timeout** — callers branch on the result; a rejection forces a try/catch for an expected outcome.

## Consequences

About 210 bytes gzip in a production app without translations. It cannot see user timers, animations, IntersectionObserver triggers, writes or fetches nothing awaits (an event handler's unawaited `save()` or `loadMany()`), or a path- or hash-mode `back()`, `forward()` or `go()` before its `popstate` fires.
