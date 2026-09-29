---
name: 'D94 — @magic-spells/puzzle/testing: app-author test utilities'
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
---

# D94 — `@magic-spells/puzzle/testing`: app-author test utilities

A published subpath (`client-runtime/testing/`, types in
`types/testing.d.ts`) so app authors can test views and whole apps:
`mountView`, `createTestApp`, `settled`, `type`, `measureRenders`,
`installFakeAnimate`, `installFakeObserver`, and a re-export of
`installFixtures` (D98). Spec: [[DOC-TESTING]].

## Why framework-owned

The async model can't be reverse-engineered from outside: `data()` is async and
last-wins, store flushes are rAF-scheduled with a hidden-tab branch and a 220ms
fallback (D63), navigation is load-then-atomic-commit, and jsdom has neither
WAAPI nor IntersectionObserver. A hand-rolled `settled()` would be subtly wrong
and flaky.

## Decision

- **`mountView(ViewClass, { props, params, store, route })`** mounts against a
  detached container with a minimal three-service `ctx`; the handle has
  `element`, `find`, `findAll`, `click`, `type`, `setProps`, `destroy`.
  `click()` completes submit-button activation and checkbox/radio
  `input`/`change` in detached jsdom.
- **`createTestApp(config)`** wraps `PuzzleApp` in memory routing (imports
  `memoryRouter()` itself; `routerInitialPath` seeds it). `visit(path)` drives
  the real router — guards, load gate, lifecycle.
- **`settled({ maxPasses = 100 })`** drains to a fixed point — store `flush()`,
  `flushUpdates()` for rAF-scheduled renders, tracked last-wins `data()` and
  navigation promises — until two microtask-stable passes find no new work.
  Exhaustion **throws** a diagnostic (an unbounded loop hangs until the runner
  timeout and names nothing; warning and returning hands the test a false
  "settled").
- **What `settled()` does not do** (contract): advance user timers or skeleton
  `min-duration` holds, resolve promises the framework never awaited, fire
  IntersectionObserver callbacks, or finish CSS / fire-and-forget WAAPI enters.
  An outgoing animation is part of an awaited navigation, so that navigation
  stays unsettled until finished or cancelled.
- **`type(target, text)`** sets `.value` and fires bubbling `input` then
  `change`, so one call drives any two-way-bound control (D147). It refuses
  checkboxes/radios (use `click()`) rather than silently no-op.
- **`measureRenders(callback)`** (or `(handle, callback)`) installs D121's
  temporary sink, awaits the callback and `settled()`, detaches in `finally`,
  and returns a deeply frozen report counting actual `ViewManager.render` entries.
- **`installFakeObserver()`** makes D73 `trigger: 'visible'` testable. Every
  install helper returns `uninstall()`.
- **Shipped code never imports `vitest`**: the fake WAAPI is a plain-closure copy
  of the internal `tests/helpers/fake-waapi.js`.

## Alternatives

- **Leave testing to userland** — see above.
- **Move `fake-waapi.js` out of `tests/helpers/`** — churns the internal suite;
  copied instead.
