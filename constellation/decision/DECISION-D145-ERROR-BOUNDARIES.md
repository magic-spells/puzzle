---
name: D145 — error boundaries + app-level onError
status: verified
connections:
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
  - DECISION-D136-VIEW-LIFECYCLE-CONVERGENCE
  - DECISION-D143-MOUNT-THROW-OWNERSHIP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
verified_at: '2026-07-28T22:30:07.464Z'
verified_sha: f639b5d1aa8f59ffe385936b7e5b5d66b1235da8
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

## Where and how the boundary face renders

- **Never patched over an unknown tree.** This is an invariant of the MANAGER,
  not only of the boundary path: `ViewManager.render()` itself routes to
  `renderFresh()` whenever `treeUnknown` is set. That matters because a view with
  no `errorContent` above it — the default — never takes the boundary path at
  all, so nothing else would ever clear the flag, and the next ordinary render
  would diff against vnodes pointing at detached nodes (updates landing on
  orphans while the visible DOM freezes).
  A throw partway through a `patch()`
  leaves the DOM matching neither the old nor the new tree, so the manager
  marks its tree UNKNOWN (bracketing the managed range with the live siblings
  outside it, the only trustworthy handles) and renders through
  `ViewManager.renderFresh()`: release BOTH aborted trees' non-DOM resources
  first (the trees lie about where nodes are, not about what exists — nested
  instances, refs, `@event:outside` document listeners, and portaled content
  all outlive raw node removal; the release walk is guarded per tree so a
  throwing user hook cannot stop the face from mounting, and `clear()` runs
  the same release so a destroy with no boundary reaches both trees), then
  clear the bracketed range by DOM removal and mount the face fresh. Healthy
  boundary renders keep the cheap diff path.
  **Known limit — the unbracketed case.** Bracketing needs the old tree's root
  to be a direct child of the manager's container. When it is not (a component
  or portal root whose node lives elsewhere, or a tree with no `el` yet),
  `unknownRange` is null: `renderFresh` removes nothing and mounts with a null
  insertion ref, so the fresh content can land beside the corrupt content rather
  than replacing it. Recovering a range with no trustworthy handle needs a
  decision this card does not yet make; what is settled is that a fresh mount
  showing current state beats a frozen tree patched over orphans.
- **A pre-mount failure is buffered, not lost.** A skeleton view's un-awaited
  preload can reject before `mount()` creates the view's ViewManager; when the
  boundary resolves to the failing view itself and no manager exists yet, the
  error parks on the instance and `mount()` flushes it once after the first
  render attempt. An ancestor boundary with a live manager still renders
  immediately — no double-fire.
- **SSG takeover: boundary first, restore as fallback.** When a takeover
  mount fails, the router tries the error boundary before restoring the
  prerendered nodes; only a boundary that did not render (absent, declined, or
  itself threw) restores the prerendered page and marker exactly as before.
- **A boundary over router-owned content invalidates the chain.** An ancestor
  boundary render unmounts routed descendants it does not own, so
  `__showErrorBoundary` first calls the router's internal chain invalidation
  (via `ctx.router`; the `/static` stub has no router and the call no-ops).
  Invalidation flags the chain (and the layout, when the boundary sits at or
  above it) as non-reusable — the reuse prefix walk reads the route entry's
  chain, so flags rather than emptied state arrays are what force `keep = 0` —
  and truncates `#state.views`/`keys` only where instances were actually
  destroyed, because `#swap` resolves outgoing teardown from `#state` and an
  instance dropped from state would never be destroyed. The next navigation
  rebuilds from scratch with a fresh layout whose `data()` re-runs.

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
