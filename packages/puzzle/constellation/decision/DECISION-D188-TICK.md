---
name: D188 — this.tick() waits for scheduled renders
status: built
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-APP
  - DECISION-D63-HIDDEN-TAB-FLUSH
  - DECISION-D185-APP-IDLE
  - DECISION-D94-TESTING-EXPORT
  - DOC-SPEC-ANATOMY
  - DOC-TESTING
  - DOC-RELEASE-SURFACE
  - TEST-RUNTIME-LIFECYCLE
---


## Context

`setData()` and store mutations schedule a render without returning a promise. View code that reads a ref or measures the DOM after the change needs to wait for that render to land.

## Decision

`view.tick()` (`await this.tick()`) returns `Promise<void>` with no import. It resolves once no store flush or view render is scheduled anywhere in the runtime, including the jobs those schedule.

`client-runtime/scheduler.js` holds the D63 frame/timer rule once: `frame(run)` uses requestAnimationFrame when visible with a 220 ms fallback timer, and a timer directly when hidden or without rAF; whichever fires first runs. Store flushes, view renders and `app.idle()` checks all use it. `schedule(job)` wraps `frame` for store flushes and view renders with a module-level pending count; `tick()` waits until the count is zero. A job is not canceled when the work is done early (a manual `flush()`, an immediate render, a destroyed view): its frame still fires, finds nothing to do, and releases the count, so tick can wait up to one frame longer in those cases.

Tick only observes. It does not force a flush, and does not wait for async `data()`, adapter fetches, navigation, locale loading, animations or user timers — `app.idle()` (D185) covers app quiescence with a timeout, and the testing `settled()` (D94) drives tracked work to convergence.

Tick is on views only. Component code, where refs live, has no handle on the app; app-level code has `app.idle()`. The queue is runtime-wide, so a view's tick also covers other views and stores sharing the runtime.

## Alternatives rejected

- **An importable function** — a built-in should not need wiring by every caller.
- **`app.tick()` as well** — a second spelling of the same runtime-wide wait, for code that already has `idle()`.
- **Wait one frame** — misses work queued by store delivery and update hooks.
- **Reuse `idle()` or `settled()`** — adds async work and quiet-frame checks, or test instrumentation and forced flushes.
- **Cancellable jobs** — return closures and per-store/per-view handles just to resolve a frame sooner.

## Consequences

The pending count is one increment per scheduled frame job, not per mutation. A self-scheduling update loop never drains; tick has no timeout.
