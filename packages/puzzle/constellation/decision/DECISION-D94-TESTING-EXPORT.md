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
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D94 — `@magic-spells/puzzle/testing`: app-author test utilities

A published subpath (`client-runtime/testing/`, types in `types/testing.d.ts`)
so app authors can test views and whole apps: `mountView`, `createTestApp`,
`settled`, `type`, `measureRenders`, `installFakeAnimate`,
`installFakeObserver`, and a re-export of `installFixtures` (D98). Spec:
[[DOC-TESTING]].

## Why framework-owned

The async model can't be reverse-engineered from outside: `data()` is async and
last-wins, store flushes run on the shared frame scheduler with a hidden-tab
branch (D63), navigation is load-then-atomic-commit, and jsdom has neither
WAAPI nor IntersectionObserver. A hand-rolled `settled()` would be subtly wrong
and flaky.

## Decision

- **`mountView(ViewClass, options)`** mounts into a detached container with a
  test `ctx` (store, an inert router unless one is passed, function registry,
  `idle`, optional `i18n`). Options: `props`, `params`, `children`, `ref`,
  `store`/`models`/`formatters`/`adapter`, `router`, `ctx`, `i18n`; `route` or
  `preloaded: true` follows the router's preload → atomic mount path. The handle
  has `element`, `find`, `findAll`, `click`, `type`, `setProps`, `destroy`.
  `click()` completes submit-button activation and checkbox/radio
  `input`/`change` in detached jsdom.
- **`createTestApp(config)`** boots a real `PuzzleApp` against a detached
  target with `memoryRouter()` (imported here; `routerInitialPath` seeds it).
  `visit(path)` drives the real router — guards, load gate, lifecycle.
- **`settled({ maxPasses = 100 })`** drains to a fixed point — store flushes,
  scheduled renders, tracked last-wins `data()` and navigation promises — until
  two microtask-stable passes find no new work. Exhaustion **throws** a
  diagnostic (an unbounded loop hangs until the runner timeout and names
  nothing; warning and returning hands the test a false "settled").
- **What `settled()` does not do** (contract): advance user timers or skeleton
  `min-duration` holds, resolve promises the framework never awaited, fire
  IntersectionObserver callbacks, or finish CSS / fire-and-forget WAAPI enters.
  An outgoing animation is part of an awaited navigation, so that navigation
  stays unsettled until finished or cancelled.
- **`type(target, text)`** sets `.value` and fires bubbling `input` then
  `change`, so one call drives any two-way-bound control (D147). It throws on
  checkboxes/radios (use `click()`) rather than silently no-op.
- **`measureRenders(callback)`** (or `(handle, callback)`) installs D121's
  temporary sink, awaits the callback and `settled()`, detaches in `finally`,
  and returns a deeply frozen report counting actual `ViewManager.render` calls.
- **`installFakeObserver()`** makes D73 `trigger: 'visible'` testable. Every
  install helper returns `uninstall()`.
- **Shipped code never imports `vitest`**: the fake WAAPI is a plain-closure copy
  of the internal `tests/helpers/fake-waapi.js`.

## Alternatives rejected

- **Leave testing to userland** — see above.
- **Move `fake-waapi.js` out of `tests/helpers/`** — churns the internal suite;
  copied instead.
