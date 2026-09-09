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
  - FEATURE-DEV-PERFORMANCE-PROFILING
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# App-author test utilities

The published `@magic-spells/puzzle/testing` subpath: helpers an application's
own suite imports. It is not the framework's internal harness, and it imports no
test runner — assertions, spies, and lifecycle hooks stay the runner's job, so
the same helpers work under any of them.

## Two ways in

`mountView(ViewClass, options)` mounts one view into a detached container with a
complete three-service context — store, router, formatters — and no app boot.
Any service may be supplied; anything absent is built, and the default router is
**inert**: `url()` is identity and every navigation method resolves having done
nothing. Passing `route` (or `preloaded: true`) follows the router-shaped
preload-then-mount path instead, so the first `data()` sees a route.

`createTestApp(config)` boots a real [[COMPONENT-PUZZLE-APP]] against a detached
container in memory routing, so the whole guard → load → atomic-commit pipeline
runs while the host URL is untouched. The helper owns `target` and `routerMode`
and overrides whatever the config said; every other option passes through.

Both return a handle with `find`/`findAll`, `click`, `type`, `destroy`, plus
`setProps` on a view and `visit` on an app. Each action settles before it
resolves, so a test asserts against a quiet DOM without sprinkling waits.

The module also re-exports `settled()`, `measureRenders()`
([[FILE-TESTING-RENDER-PROFILE]]), the two DOM fakes, and `installFixtures` from
[[COMPONENT-FIXTURES]] — one import reaches every test affordance the framework
ships.

## Settling

`settled()` drains framework-owned work to a fixed point. Each pass flushes
registered stores, applies scheduled view renders, awaits the current last-wins
data and navigation promises, and repeats; two unchanged microtask-stable passes
end it. That structure is deliberate — it must not depend on a real animation
frame or on the hidden-tab fallback timer firing.

Reaching those promises needs instrumentation, because a view's `data()` token
is private and store notifications fire subscriber refreshes without handing
back promises. The first use of any helper patches the view prototype's refresh,
re-render, and destroy paths, and each registered router instance has its
navigation methods wrapped. Wrappers preserve identity, return values, and
rejection behavior. Last-wins is respected: a newer refresh or navigation
releases the older promise, and destroying a view releases its suspended run
rather than holding `settled()` open forever.

## Invariants

- **Nothing here can reach a production bundle.** No core module imports this
  one, in either direction of the dependency graph.
- **View instrumentation installs once per realm and is never removed.** Helpers
  are used across a whole suite, so removal would be the surprising behavior.
  Router wrapping is the opposite: per instance, reference-counted, and restored
  exactly when the last handle registered against it is destroyed.
- **`settled()` drains framework work only.** It does not advance user timers,
  resolve a promise nothing awaited, fire visibility observers, or finish
  CSS/WAAPI animations.
- **Handles are detached.** Nothing is in the document, so anything keying off
  connectedness or layout behaves accordingly.
- **`destroy()` is idempotent** and unregisters both the store and the router.

## Gotchas

- An awaited outgoing animation keeps its navigation unsettled, so a transition
  test hangs until the animation is finished or cancelled — pair it with the
  WAAPI fake. Fire-and-forget enter animations are not awaited and do not.
- Convergence is bounded at 100 passes; exhausting it throws a diagnostic naming
  the most active work sources rather than reporting a false quiet state. A
  `data()` → store-write → `data()` cycle is the usual cause; a legitimately deep
  chain can raise the bound.
- `type()` refuses a checkbox or radio and says so: those have no text value, and
  a bound checkbox re-reads its checked state, so a silent no-op would look like
  it worked. Toggle them with `click()`.
- `type()` fires both `input` and `change`, which is what a real edit-then-leave
  produces, so one call drives every bound control without the test knowing which
  event carries that control's write.
- `click()` reproduces two activation behaviors jsdom skips on detached elements:
  submit-button form submission, and the input/change pair after a checkbox or
  radio toggles.
- `routerInitialPath` is consumed by `createTestApp` itself and never reaches
  `PuzzleApp` — it is the one memory-mode option a test routinely needs.
- Both entry points require a DOM and say so by name when there is none.
