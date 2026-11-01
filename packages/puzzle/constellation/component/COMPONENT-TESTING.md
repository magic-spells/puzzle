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
  - FLOW-REACTIVITY
  - FLOW-NAVIGATION
  - FILE-PACKAGE
  - DOC-TESTING
  - DOC-SPEC-BUILD
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D121-DEV-PERFORMANCE-PROFILING
  - DECISION-D159-ROUTER-MODE-FACTORIES
  - DECISION-D185-APP-IDLE
  - DECISION-D189-AGENT-HOOKS
verified_at: '2026-11-01T19:23:56.488Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# App-author test utilities

The published `@magic-spells/puzzle/testing` subpath (`client-runtime/testing/`): helpers an application's own suite imports ([[DECISION-D94-TESTING-EXPORT]]). Not the framework's internal harness; imports no test runner. Author contract: [[DOC-SPEC-BUILD]] §53 and [[DOC-TESTING]].

## Entry points

- **`mountView(ViewClass, options)`** mounts one view into a detached container with a `{ store, router, formatters, idle }` ctx and no app boot. Absent services are built: a Store over `options.models` (with `options.adapter` validated and installed, so tracked finds can fetch), and an inert router (`url()` is identity, navigation methods resolve doing nothing). With no app to observe, `ctx.idle()` runs `settled()` and resolves `true` ([[DECISION-D189-AGENT-HOOKS]]); a caller's `ctx.idle` wins. `route` (or `preloaded: true`) takes the preload-then-mount path so the first `data()` sees a route. `i18n: { locale, strings }` builds a translations service into the ctx and installs `t` (a caller `ctx.i18n` wins), awaiting it before construction.
- **`createTestApp(config)`** boots a real [[COMPONENT-PUZZLE-APP]] on a detached container in memory routing (`memoryRouter({ initialPath: routerInitialPath })` — `routerInitialPath` is consumed here and never reaches PuzzleApp; [[DECISION-D159-ROUTER-MODE-FACTORIES]]). It owns `target` and `routerMode`; everything else passes through. `i18n: { locale, strings }` goes through PuzzleApp's internal `__i18n` seam, so the real wiring runs. One table only; multi-locale tests stub `fetch`.
- Handles expose `element`, `find`/`findAll`, `click`, `type`, `destroy`, plus `setProps` (view) and `visit` (app); every action settles before resolving.
- Re-exports `settled()`, `measureRenders()` ([[FILE-TESTING-RENDER-PROFILE]]), the WAAPI and IntersectionObserver fakes, and `installFixtures` ([[COMPONENT-FIXTURES]]).

## Settling

`settled()` drains framework work to a fixed point: flush registered stores, apply scheduled renders, await current last-wins `data()` and navigation promises, and repeat until two unchanged passes — without waiting for a real frame or the hidden-tab timer. It reaches private promises by patching `PuzzleView.prototype` `refresh`/`setData`/`destroy` (once per realm, never removed) and wrapping each registered router's navigation methods (per instance, ref-counted, restored when the last handle goes). Wrappers preserve identity, return values and rejections; a newer refresh releases the older promise and a destroyed view releases its pending one. `app.idle()` ([[DECISION-D185-APP-IDLE]]) is the observing, production counterpart — it lives on `PuzzleApp`, not here.

## Invariants

- Nothing here reaches a production bundle — no core module imports it.
- `settled()` drains framework work only: no user timers, unawaited promises, observers, or CSS/WAAPI animations.
- Handles are detached (not in the document). `destroy()` is idempotent and unregisters store and router.

## Gotchas

- An awaited outgoing animation keeps its navigation unsettled — use the WAAPI fake. Fire-and-forget enters are not awaited.
- Convergence is capped (`{ maxPasses }`, default 100); exhaustion throws naming the busiest sources (a `data()` → store write → `data()` cycle is the usual cause).
- `type()` refuses checkboxes/radios (use `click()`) and fires both `input` and `change`.
- `click()` reproduces what jsdom skips on detached elements: submit-button form submission and the input/change pair after a checkbox/radio toggle.
- Both entry points require a DOM and say so by name.
