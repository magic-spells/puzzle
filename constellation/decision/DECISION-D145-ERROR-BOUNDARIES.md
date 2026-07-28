---
name: D145 — error boundaries + app-level onError
status: built
connections:
  - DECISION-D115-FAILED-MOUNT-PLACEHOLDER
  - DECISION-D136-VIEW-LIFECYCLE-CONVERGENCE
  - DECISION-D143-MOUNT-THROW-OWNERSHIP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
---

# D145 — error boundaries + app-level `onError`

The app-facing error story on top of the D115/D136/D143 recovery machinery,
whose ownership semantics are unchanged — this decision gives the existing
catch sites one reporting funnel and a fallback-render face. Before it, every
contained failure dead-ended in `console.error` and the user saw a blank hole.

## The funnel (`client-runtime/errors.js`)

Every framework-contained app error reports through `reportError(ctx, error,
info, ...consoleArgs)`. `new PuzzleApp({ onError })` registers the hook;
without one, the funnel replays the exact `console.error` call the catch site
always made. The hook receives `(error, info)` with a frozen stable
`info = { phase, view, route }` — phases include `mount`, `refresh`,
`navigation`, `transition`, `leave`, and `boundary`. A throwing (or rejecting
async) `onError` is contained at the funnel with its own `console.error` and
never re-enters the funnel. The handler lives in a WeakMap keyed by ctx —
the documented three-service ctx object is NOT widened.

## Per-view boundary (`errorContent`)

A script-side PuzzleView member — zero compiler changes (the
compiler-over-runtime rule cuts the other way here: no template grammar was
needed): `errorContent(error)` returns a ViewNode tree rendered in place of the
invisible failed-mount placeholder when the view's own mount/refresh fails.
Lookup walks the owner chain (each ViewManager records its owning view);
nearest implementation wins; returning null declines the error outward; an
`errorContent` that itself throws reports with `phase: 'boundary'` and lookup
continues with the new error. For failed mounts the fallback is captured
BEFORE the D115 teardown and mounted beside the recovery placeholder, so the
owner's `refresh()` retries through the normal placeholder re-mount and
removes the fallback.

## Deliberate exclusions (not funneled)

Rethrow-to-caller paths (`beforeMount`, `router.start()` — the `mount()`
caller owns those), explicit navigation verdicts (a guard returning false),
input-capability fallbacks (invalid anchors/selectors/session-storage), and
event handlers/formatters, which surface uncaught as ever.

## Alternatives rejected

- **A wrapper `<ErrorBoundary>` component**: new grammar and marker surface for
  what a class member expresses; the member also keeps the boundary next to
  the view whose failure it styles.
- **Global-only handler with no fallback UI**: closes the reporting gap but
  leaves the blank-hole UX that motivated the feature.
- **Widening ctx with the handler**: the three-service ctx is a documented
  selling point (D60 re-rejection); the WeakMap keeps the surface intact.
