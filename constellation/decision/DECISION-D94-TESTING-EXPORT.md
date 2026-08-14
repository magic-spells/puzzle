---
name: 'D94 — `@magic-spells/puzzle/testing`: app-author test utilities (v1.58)'
status: built
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-PUZZLE-APP
  - COMPONENT-STORE
  - DOC-TESTING
  - DECISION-D42-MEMORY-MODE
  - DECISION-D63-HIDDEN-TAB-FLUSH
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
  - DOC-SPEC
---

A fifth export subpath — `mountView`, `createTestApp`, `settled`,
`measureRenders`, `installFakeAnimate`, `installFakeObserver` — so people
building apps with Puzzle can test them. `measureRenders` is the D121 amendment.

## Context

Puzzle shipped no test utilities for app authors. Everything in `tests/helpers/` was internal and unpublished. React has Testing Library, Vue has `@vue/test-utils`, Ember has `@ember/test-helpers` with `visit`/`click`/`await settled()`, Angular has `TestBed`.

This mattered more for Puzzle than for most frameworks because **the async model cannot be reverse-engineered from outside**: `data()` is async and last-wins, the store flush is rAF-scheduled with a `document.hidden` branch and a 220 ms fallback timer (D63), navigation is load-then-atomic-commit, and jsdom ships neither WAAPI nor IntersectionObserver. A correct `settled()` is framework-owned knowledge; an app author writing their own would get it subtly wrong and inherit flaky tests.

## Decision

Publish the helpers, and make `settled()` the centrepiece.

- **New `./testing` subpath**, alongside `./morph`, `./ssg`, `./static`, `./puzzle-env`. Source in `client-runtime/testing/`, types in `types/testing.d.ts`. The existing `files` globs already covered it.
- **`mountView(ViewClass, { props, params, store, route })`** wraps `PuzzleView.prototype.mount` — already the right shape — against a detached container with a minimal three-service `ctx`. Returns a handle with `element`, `find`, `findAll`, `click`, `setProps`, `destroy`.
- **`createTestApp(config)`** wraps `PuzzleApp` in memory routing — it imports `memoryRouter()` itself (D159) and takes `routerInitialPath` as its own option to seed it. This packages an intended use rather than inventing capability: `app.js` already documents memory mode as being for "tests/embeds". `visit(path)` drives the real router, so the real load-then-commit pipeline, guards, and lifecycle all run.
- **`settled()` drains to a fixed point** — stores through the public idempotent `flush()`, rAF-scheduled `setData` renders through `flushUpdates()`, the current last-wins `data()`/navigation promises — repeating until two microtask-stable passes produce no new work. Two passes, because work created by a promise continuation must be caught without depending on rAF or D63's 220 ms timer firing.
- **The loop is bounded** (`maxPasses`, default 100) and **throws on exhaustion**. Unbounded, a `data()` → store-write → `data()` cycle or a timer-driven store mutation hangs until the runner's global timeout, reporting "test timed out" and naming nothing — the worst possible signature for the one call every test awaits. It gets blamed for the app's bug.
- **`measureRenders(handle, callback)` is runner-neutral.** It installs D121's
  temporary performance sink, awaits the callback and this same `settled()`
  fixed point, detaches in `finally`, and returns a deeply frozen report. It
  counts actual `ViewManager.render` entries, not coalescible `refresh()` calls.
- **Its boundaries are documented as first-class contract**, not omissions. `settled()` does *not* advance arbitrary user timers or skeleton `min-duration` holds, resolve promises `data()`/navigation never awaited, fire IntersectionObserver callbacks, or finish CSS/fire-and-forget WAAPI enter animations. Because an outgoing animation *is* part of an awaited navigation, that navigation stays unsettled until the test finishes or cancels it.
- **The shipped module must not import `vitest`.** The internal `fake-waapi.js` did, which is fine for a repo helper and unacceptable in a published package. It was **copied** into the module (not moved) so the existing suite keeps working untouched.
- **`installFakeObserver()`** provides the IntersectionObserver jsdom lacks, so D73's `trigger: 'visible'` animations are testable. Every install helper returns `uninstall()`.

## Consequences

- App authors can test views and whole apps without reaching into framework internals.
- **Dogfooding found real bugs.** Porting four canonical todos behaviors onto the public helpers exposed detached-jsdom activation gaps; `click()` now correctly completes submit-button activation and checkbox/radio `input`/`change` events. This is the argument for requiring dogfooding rather than accepting a green suite.
- `verify:pack` confirms all five files and the type declaration ship.
- **No `fillIn()`** — typing still means setting `.value` and dispatching `input`, matching the existing suite. A candidate for the next round.

## Alternatives rejected

- **An unbounded fixed-point loop** — hangs instead of diagnosing; see above.
- **Warning and returning on exhaustion** rather than throwing — hands the test a false "settled" and surfaces as a confusing downstream assertion failure instead of naming the real problem.
- **Importing `vitest` in shipped code** so the fake WAAPI could reuse `vi.fn()` — a published module must not depend on a test runner. Plain closure-recorded call logs work.
- **Moving `fake-waapi.js`** out of `tests/helpers/` instead of copying — churns the existing suite for no benefit while this stabilizes.
- **Leaving this to userland** — `settled()` depends on rAF scheduling, the hidden-tab branch, the fallback timer, and last-wins `data()` semantics. No app author can write it correctly, and a wrong one produces flakiness they will blame on the framework.
