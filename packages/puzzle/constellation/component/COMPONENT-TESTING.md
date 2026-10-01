---
name: App-author test utilities (@magic-spells/puzzle/testing)
status: verified
connections:
  - FILE-TESTING
  - FILE-TESTING-SETTLED
  - FILE-TESTING-FAKE-WAAPI
  - FILE-TESTING-FAKE-OBSERVER
  - FILE-TESTING-RENDER-PROFILE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - COMPONENT-FIXTURES
  - COMPONENT-ANIMATIONS
  - FLOW-REACTIVITY
  - FLOW-NAVIGATION
  - STATE-VIEW-LIFECYCLE
  - FILE-PACKAGE
  - DOC-TESTING
  - DOC-RELEASE-SURFACE
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D159-ROUTER-MODE-FACTORIES
  - DECISION-D42-MEMORY-MODE
  - DECISION-D28-ANIMATIONS
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
  - DECISION-D63-HIDDEN-TAB-FLUSH
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# App-author test utilities

The published `@magic-spells/puzzle/testing` subpath (`client-runtime/testing/`): helpers
an application's own suite imports. Not the framework's internal harness; imports no test
runner. Author contract: [[DOC-SPEC-BUILD]] §53, [[DOC-TESTING]].

## Entry points

- **`mountView(ViewClass, options)`** mounts one view into a detached container with a
  full `{ store, router, formatters }` ctx and no app boot; absent services are built, and
  the default router is inert (`url()` is identity, navigation resolves doing nothing).
  `route` (or `preloaded: true`) takes the preload-then-mount path so the first `data()`
  sees a route. `i18n: { locale, strings }` builds a service into the ctx and installs `t`
  (a caller `ctx.i18n` wins), awaiting `__ready()` before construction.
- **`createTestApp(config)`** boots a real [[COMPONENT-PUZZLE-APP]] on a detached
  container in memory routing (`memoryRouter({ initialPath: routerInitialPath })` —
  `routerInitialPath` is consumed here and never reaches PuzzleApp). It owns `target` and
  `routerMode`; everything else passes through. `i18n: { locale, strings }` goes through
  PuzzleApp's internal `__i18n` seam, so real wiring runs. Single-table by design;
  multi-locale tests stub `fetch`.
- Handles expose `find`/`findAll`, `click`, `type`, `destroy`, plus `setProps` (view) and
  `visit` (app); every action settles before resolving.
- Re-exports `settled()`, `measureRenders()` ([[FILE-TESTING-RENDER-PROFILE]]), the WAAPI
  and IntersectionObserver fakes, and `installFixtures` ([[COMPONENT-FIXTURES]]).

## Settling

`settled()` drains framework work to a fixed point: flush registered stores, apply
scheduled renders, await current last-wins data and navigation promises, repeat until two
unchanged microtask-stable passes — never depending on a real frame or the hidden-tab
timer. It reaches private promises by patching the view prototype's refresh/re-render/
destroy paths (once per realm, never removed) and wrapping each registered router's
navigation methods (per instance, ref-counted, restored when the last handle goes).
Wrappers preserve identity, return values and rejections; a newer refresh releases the
older promise and a destroyed view releases its suspended run.

## Invariants

- Nothing here reaches a production bundle — no core module imports it.
- `settled()` drains framework work only: no user timers, unawaited promises, observers,
  or CSS/WAAPI animations.
- Handles are detached (not in the document). `destroy()` is idempotent and unregisters
  store and router.

## Gotchas

- An awaited outgoing animation keeps its navigation unsettled — use the WAAPI fake.
  Fire-and-forget enters are not awaited.
- Convergence is capped at 100 passes; exhaustion throws naming the busiest sources (a
  `data()` → store write → `data()` cycle is the usual cause).
- `type()` refuses checkboxes/radios (use `click()`) and fires both `input` and `change`.
- `click()` reproduces what jsdom skips on detached elements: submit-button form
  submission and the input/change pair after a checkbox/radio toggle.
- Both entry points require a DOM and say so by name.
