---
name: D185 — app.idle
status: built
connections:
  - FEATURE-APP-IDLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - DOC-SPEC-ANATOMY
  - DOC-TESTING
  - DOC-RELEASE-SURFACE
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D63-HIDDEN-TAB-FLUSH
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D182-NAVIGATION-RESULT
  - DECISION-D157-ADAPTER-SUBPATH
---

## Context

Code driving a running app from outside (an agent bridge, an end-to-end script, a demo recorder) needs to know when the app has finished reacting. `router.push()` resolves when its navigation lands (D182), but a store write, a `setData()`, an async `data()` or an auto-fetching find (D161) has no promise anyone can hold. Drivers polled the DOM on a timer. The testing module's `settled()` (D94) answers the question for tests, but it monkey-patches `PuzzleView` and router prototypes on first use and forces flushes, which production must never do.

## Decision

`app.idle({ timeout = 10000 })` returns a promise of a boolean. It resolves `true` once two consecutive checks, one frame apart, find all of these clear:

- no `mount()` in flight (the app's own `#mountPromise`);
- no navigation in flight: the router's `#pendingNavPromise`, read through `navigating(router)`, a module-level function bound in Router's static block, so no public member is added;
- no scheduled store flush (`_flushScheduled`, which every pending notification and batched persist arms);
- no async `data()` evaluation running (`_asyncTrackingChain`, which serializes them);
- on adapter apps, no tracked find's fetch in flight: `store._reading?.()`, a method the adapter installs that reads its existing per-store read state (`one`/`many` in-flight maps). A no-adapter app ships only the optional call site.

A view mid-settle is covered by those last two: between fetch rounds it is either awaiting a request in the read state or re-running `data()`, and the microtask gaps between them fall inside a frame.

Each check runs after its frame's callbacks (rAF, then a 0 ms timer), so a `setData()` render scheduled before the previous check has landed by the next one. Frames follow the store's D63 scheduler: timers in a hidden tab, and a 220 ms fallback timer beside each rAF if the tab hides mid-wait.

It reads existing state only; no counters or bookkeeping were added. It never rejects. A timeout that is not a finite number ≥ 0 logs a development error and falls back to 10000. An app neither mounted nor mounting (never mounted, or after `unmount()`) resolves `true` at once; an unmount mid-wait resolves `true` at the next check. A `mount()` that never settles (the D177 first-visit redirect) times out `false`.

## Alternatives rejected

- **Reuse `settled()`** — it patches prototypes and forces flushes; production must observe, not drive.
- **Per-operation counters (pending fetches, pending renders)** — new bookkeeping on hot paths for a diagnostic API.
- **Read each view's private `#updateScheduled`** — there is no registry of live view instances to walk without adding one; the frame-aligned check covers the same renders.
- **A public `router.navigating` getter** — public surface for an internal question; the static-block accessor costs a few bytes and no API.
- **Reject on timeout** — callers branch on the result; a rejection forces a try/catch for an expected outcome.

## Consequences

About 180 bytes gzip in a production app. It shares `settled()`'s limits: user timers, animations, an IntersectionObserver trigger, and fetches nothing awaits (an explicit `record.save()` or `store.loadMany()` fired from an event handler) are not work it can see. A `setData()` render in a hidden tab waits for a frame the tab never runs, and `idle()` cannot see it there. A `router.back()` in path or hash mode is in flight only once `popstate` fires. `timeout: 0` resolves `false` unless nothing is mounted.
