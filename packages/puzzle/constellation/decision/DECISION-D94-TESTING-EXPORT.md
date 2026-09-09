---
name: 'D94 — `@magic-spells/puzzle/testing`: app-author test utilities (v1.58)'
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-PUZZLE-APP
  - COMPONENT-STORE
  - DOC-TESTING
  - DECISION-D42-MEMORY-MODE
  - DECISION-D63-HIDDEN-TAB-FLUSH
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
  - DOC-SPEC
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

An export subpath for app authors — `mountView`, `createTestApp`, `settled`,
`type`, `measureRenders`, `installFakeAnimate`, `installFakeObserver`, plus a
convenience re-export of `installFixtures` — so people building apps with Puzzle
can test them. `measureRenders` is D121's contribution to this surface.

## Context

Puzzle shipped no test utilities for app authors. Everything in `tests/helpers/` was internal and unpublished. React has Testing Library, Vue has `@vue/test-utils`, Ember has `@ember/test-helpers` with `visit`/`click`/`await settled()`, Angular has `TestBed`.

This mattered more for Puzzle than for most frameworks because **the async model cannot be reverse-engineered from outside**: `data()` is async and last-wins, the store flush is rAF-scheduled with a `document.hidden` branch and a 220 ms fallback timer (D63), navigation is load-then-atomic-commit, and jsdom ships neither WAAPI nor IntersectionObserver. A correct `settled()` is framework-owned knowledge; an app author writing their own would get it subtly wrong and inherit flaky tests.

## Decision

Publish the helpers, and make `settled()` the centrepiece.

- **A `./testing` subpath**, one of the package's published exports beside
  `./adapter`, `./morph`, `./router-modes`, `./ssg`, `./static`, `./fixtures`,
  and `./puzzle-env`. Source in `client-runtime/testing/`, types in
  `types/testing.d.ts`. The existing `files` globs already covered it.
- **`mountView(ViewClass, { props, params, store, route })`** wraps `PuzzleView.prototype.mount` — already the right shape — against a detached container with a minimal three-service `ctx`. Returns a handle with `element`, `find`, `findAll`, `click`, `type`, `setProps`, `destroy`.
- **`createTestApp(config)`** wraps `PuzzleApp` in memory routing — it imports `memoryRouter()` itself (D159) and takes `routerInitialPath` as its own option to seed it. This packages an intended use rather than inventing capability: `app.js` already documents memory mode as being for "tests/embeds". `visit(path)` drives the real router, so the real load-then-commit pipeline, guards, and lifecycle all run.
- **`settled()` drains to a fixed point** — stores through the public idempotent `flush()`, rAF-scheduled `setData` renders through `flushUpdates()`, the current last-wins `data()`/navigation promises — repeating until two microtask-stable passes produce no new work. Two passes, because work created by a promise continuation must be caught without depending on rAF or D63's 220 ms timer firing.
- **The loop is bounded** (`maxPasses`, default 100) and **throws on exhaustion**. Unbounded, a `data()` → store-write → `data()` cycle or a timer-driven store mutation hangs until the runner's global timeout, reporting "test timed out" and naming nothing — the worst possible signature for the one call every test awaits. It gets blamed for the app's bug.
- **`measureRenders(callback)` is runner-neutral**, and accepts the
  `measureRenders(handle, callback)` form too when naming the subject reads
  better — the sink is global, so the handle documents the call site rather than
  being inspected. It installs D121's temporary performance sink, awaits the
  callback and this same `settled()` fixed point, detaches in `finally`, and
  returns a deeply frozen report. It counts actual `ViewManager.render` entries,
  not coalescible `refresh()` calls.
- **Its boundaries are documented as first-class contract**, not omissions. `settled()` does *not* advance arbitrary user timers or skeleton `min-duration` holds, resolve promises `data()`/navigation never awaited, fire IntersectionObserver callbacks, or finish CSS/fire-and-forget WAAPI enter animations. Because an outgoing animation *is* part of an awaited navigation, that navigation stays unsettled until the test finishes or cancels it.
- **The shipped module must not import `vitest`.** The internal `fake-waapi.js` did, which is fine for a repo helper and unacceptable in a published package. It was **copied** into the module (not moved) so the existing suite keeps working untouched.
- **`installFakeObserver()`** provides the IntersectionObserver jsdom lacks, so D73's `trigger: 'visible'` animations are testable. Every install helper returns `uninstall()`.

## Consequences

- App authors can test views and whole apps without reaching into framework internals.
- **Dogfooding found real bugs.** Porting four canonical todos behaviors onto the public helpers exposed detached-jsdom activation gaps; `click()` now correctly completes submit-button activation and checkbox/radio `input`/`change` events. This is the argument for requiring dogfooding rather than accepting a green suite.
- The module needs no packaging change of its own: it sits inside the
  `client-runtime/**` and `types/**` trees the tarball already ships and
  `verify:pack` already polices.
- **Typing is `type(target, text)`**, exported standalone and as a handle method:
  it sets `.value` and fires the bubbling `input` and `change` pair a real
  edit-then-leave produces, so one call drives every two-way-bound control (D147)
  without the test knowing which event carries that control's write. It refuses a
  checkbox or radio and says to use `click()` — those have no text value, and a
  silent no-op would look like it worked.

## Alternatives rejected

- **An unbounded fixed-point loop** — hangs instead of diagnosing; see above.
- **Warning and returning on exhaustion** rather than throwing — hands the test a false "settled" and surfaces as a confusing downstream assertion failure instead of naming the real problem.
- **Importing `vitest` in shipped code** so the fake WAAPI could reuse `vi.fn()` — a published module must not depend on a test runner. Plain closure-recorded call logs work.
- **Moving `fake-waapi.js`** out of `tests/helpers/` instead of copying — churns the existing suite for no benefit while this stabilizes.
- **A `type()` that silently no-ops on a checkbox** — a bound checkbox re-reads
  its checked state, so the write would be invisible and the test would look
  correct while asserting nothing.
- **Leaving this to userland** — `settled()` depends on rAF scheduling, the hidden-tab branch, the fallback timer, and last-wins `data()` semantics. No app author can write it correctly, and a wrong one produces flakiness they will blame on the framework.
