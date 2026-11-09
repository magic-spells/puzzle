---
name: D185 — app.idle
status: built
connections:
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
notes:
  - kind: decision
    text: >-
      The navigation read is `static navigating(router)` on Router, not a class static block and not
      an instance getter. A static block is a side effect that pinned the whole Router into every
      output:'static' shared chunk (static-docs 25,606 → 18,452 gzip; i18n --static 29,182 → 21,586
      gzip, measured with the CLI built from source). A static method tree-shakes and is within 1 B
      gzip of the getter (todos production: 27,554 vs 27,553), so it keeps the no-instance-member
      intent at no cost. Never reintroduce a `static {}` block in router.js;
      tests/static-docs-example.test.js fails if `popstate` reappears in a static build.
---

# D185 — app.idle

## Context

Code driving a running app from outside (an agent bridge, an end-to-end script, a demo recorder) needs to know when the app has finished reacting. `router.push()` resolves when its navigation lands (D182), but a store write, a `setData()`, an async `data()`, an auto-fetching find (D161) or a locale switch (D175) has no promise anyone can hold. The testing module's `settled()` (D94) answers the question for tests, but it patches `PuzzleView` and router prototypes on first use and forces flushes, which production must never do.

## Decision


```js
const quiet = await app.idle({ timeout: 10000 }); // true when idle; false on timeout
```

`app.idle({ timeout = 10000 })` returns a promise of a boolean. It resolves `true` once two consecutive checks, one frame apart, find all of these clear:

- no `mount()` in flight (the app's own `#mountPromise`);
- no navigation in flight: the router's `#pendingNavPromise`, read through the static method `Router.navigating(router)`, so no instance member is added and a bundle that never references `Router` still drops the class;
- no scheduled store flush (`_flushScheduled`, which every pending notification and batched persist arms);
- no store flush or view render job waiting for its frame: `scheduled()`, the scheduler's pending count (the one `renderTick()` waits on, D188). idle's own checks use `frame()`, not `schedule()`, so they never count themselves. This catches a render chain, such as an `afterUpdate()` that schedules another render every frame;
- no async `data()` evaluation running (`_asyncTrackingChain`, which serializes them);
- no `setLocale()` switch loading: the i18n service's internal `__busy` flag, set when a switch starts its fetch and cleared when the switch owning the latest token settles (its re-render included), by a same-locale no-op that overtakes it, or at dispose. The read sits behind `__PUZZLE_HAS_I18N__`, so an app without translations ships none of it;
- on adapter apps, no tracked find's fetch in flight: `store._reading?.()`, a method the adapter (`datastore/adapter.js`) installs over its existing per-store read state (`one`/`many` in-flight maps). A no-adapter app ships only the optional call.

A view mid-settle is covered by the fetch and `data()` reads: between fetch rounds it is either awaiting a request or re-running `data()`, and the microtask gaps between them fall inside a frame.

The rule is **no per-operation bookkeeping**: idle reads state the runtime already keeps. The i18n flag is the one addition, one boolean per user-initiated locale switch, not a counter on a hot path.

Each check runs after its frame's callbacks (rAF, then a 0 ms timer). Frames come from the D63 scheduler in `client-runtime/scheduler.js`, shared with store flushes, view renders and `renderTick()`: a 0 ms timer in a hidden tab, and a 220 ms fallback timer beside each rAF, cleared when the frame wins, in case the tab hides mid-wait. A view's `setData()` render uses the same scheduler, so it lands in a background tab.

It never rejects. A timeout that is not a finite number ≥ 0 falls back to 10000 in every build (otherwise `NaN` or `Infinity` would never time out); development also logs an error. An app neither mounted nor mounting (never mounted, or after `unmount()`) resolves `true` at once; an unmount mid-wait resolves `true` at the next check. A `mount()` that never settles (the D177 first-visit redirect) times out `false`. `timeout: 0` resolves `false` unless nothing is mounted.

## Alternatives rejected

- **Reuse `settled()`**: it patches prototypes and forces flushes; production must observe, not drive.
- **Per-operation counters (pending fetches, pending writes)**: new bookkeeping on hot paths for a diagnostic API. Pending renders need none: the scheduler already counts them for `renderTick()`.
- **Read each view's private `#updateScheduled`**: there is no registry of live view instances to walk without adding one; the scheduler's pending count covers the same renders.
- **A public `router.navigating` getter**: public instance surface for an internal question. It tree-shakes as well as the static method and measures the same (todos production bundle: 5 B raw / 1 B gzip smaller), so the choice is about surface, not size.
- **A module-level `navigating` function bound in Router's class static block**: a static block is a side effect, so the bundler keeps the whole `Router` class (and the modules only it uses) in every graph that imports any name from `router/router.js`. The `output: 'static'` kernel, the SSG assembler and `i18n.js` import path helpers from there, so every static site shipped the router in its shared chunk, breaking D81's "no router" promise. Measured with the CLI built from source, `--mode production`: examples/static-docs shared chunk 76,924 B / 25,606 gzip with the block, 54,752 B / 18,452 gzip without (−7,154 gzip, −28%); examples/i18n `--static` −7,596 gzip. Static methods are not side effects, so `Router.navigating` costs a router-free bundle nothing. `tests/static-docs-example.test.js` asserts no built module mentions `popstate`.
- **Reject on timeout**: callers branch on the result; a rejection forces a try/catch for an expected outcome.

## Consequences

idle cannot see user timers, animations, IntersectionObserver triggers, writes or fetches nothing awaits (an event handler's unawaited `save()` or `loadMany()`), or a path- or hash-mode `back()`, `forward()` or `go()` before its `popstate` fires. Tests: `tests/app-idle.test.js`.
