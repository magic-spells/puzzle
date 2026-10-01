---
name: D145 — app-level onError + the app error view (errorView)
status: verified
connections:
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
  - DECISION-D136-VIEW-LIFECYCLE-CONVERGENCE
  - DECISION-D143-MOUNT-THROW-OWNERSHIP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/views/viewManager.js
  - client-runtime/router/router.js
---

# D145 — app-level `onError` + the app error view (`errorView`)

## Context

The D115/D136/D143 recovery machinery contains mount/refresh/render failures,
but without an app-facing layer every contained failure ended in
`console.error` and a blank hole. Apps need one reporting hook and one
replacement face, without per-view boilerplate.

## Decision

**The funnel (`client-runtime/errors.js`).** Every framework-contained app
error goes through `reportError(ctx, error, info, ...consoleArgs)`.
`new PuzzleApp({ onError })` registers the hook; without one the funnel
replays the catch site's `console.error`. The hook gets `(error, info)` with a
frozen `info = { phase, view, route }`; `view`/`route` are coerced to `null`
when absent (the app phases always have `view: null`). The phase set is closed
and pinned in tests-types (`PuzzleErrorInfo` in `types/index.d.ts`):
- view positions — `mount`, `refresh`, `render`, `bind`, `enter`, `leave`,
  `unmount`;
- navigation — `navigation`, `transition`;
- app — `app-mount`, `app-unmount`;
- terminal — `error-view` (never produces a replacement).

Only current-run failures report: `PuzzleView.refresh` applies the same
token/destroyed/leaving check to rejections as to fulfillments, and D161's
settle loop checks `isStale()` on both arms. A throwing or rejecting `onError`
is contained with its own `console.error` and never re-enters the funnel.
Config lives in a WeakMap keyed by ctx — the three-service ctx is not widened.

**The error view.** `new PuzzleApp({ errorView })` takes ONE ordinary compiled
view (typically `app/views/AppError.pzl`); a non-view value is a construction
error. After the funnel report, a failed mount/refresh is replaced AT ITS
EXACT POSITION by a fresh error-view instance; parent, siblings and layout keep
their state. Props: `error`, `info` (the same frozen object), and `retry`
(identity-stable for that instance).
- **Replacement, never re-render.** The broken instance is destroyed first and
  never asked to render its own fallback.
- **Explicit retry through the owner's normal path; nothing retries
  automatically.** Routed view/layout: the Router replaces its current
  location, bypassing only the same-path short circuit; `chainInvalid` forces
  `keep = 0`, so the whole chain rebuilds. Child component: the D115
  placeholder stays and the parent runs `refresh()`; `patchComponent` mounts a
  fresh child from the new vnode (current props/slots, not captured inputs).
- **A retry never blanks its position.** A routed error view stays mounted for
  the whole rebuild and is vacated only by something that refills it: a commit,
  or a load-phase failure (which commits nothing, D19/D61) swapping in a face
  with the new error via `__retryErrorView`. Guard block, no-op redirect and
  supersession exits leave the face as is — a same-path push is deduped, so a
  blanked position would be unrecoverable. The component path releases the
  face on dispatch (the owner's re-render refills it); if the owner's
  `refresh()` rejects, it refills with a new face reported as phase `refresh`.
- **Single-flight per press.** A second call during the rebuild is ignored;
  the latch re-arms when the rebuild ends with the same face still mounted, so
  a blocked retry stays pressable. A replaced or removed face's callback is a
  no-op.
- **Ownership follows the position.** A component's replacement is owned by
  the parent's patch (removal/replacement/keyed reorder carry it); a routed
  one by the router (navigating away tears it down; failed chains are never
  reused). Replacement never lands at an ancestor, so no ancestor renders over
  router-owned descendants.
- **The error view failing** reports once as `error-view` and stops; the
  placeholder stays for a later patch or navigation.
- **SSG takeover:** the error view renders first; only without one (or if it
  fails) is the prerendered page restored (D140).
- **No `errorView`:** the funnel still reports, the invisible placeholder
  stays, and the owner's `refresh()` remounts through it. No built-in error UI.
- **Prerender:** a build-time failure fails the build; the error view never
  renders into generated HTML.

**Rendering invariants.**
- **Never patch over an unknown tree.** A throw mid-`patch()` sets the
  manager's `treeUnknown`; the next `render()` goes to `renderFresh()`, which
  releases both aborted trees' non-DOM resources (instances, refs, `:outside`
  listeners, portals — guarded per tree), clears the bracketed range
  (`unknownRange`, from the live siblings outside it), and mounts fresh.
  `clear()` runs the same release. Known limit: bracketing needs the old root
  to be a direct child of the container; otherwise `unknownRange` is null, and
  fresh content can land beside the corrupt content. Undecided.
- **Pre-mount failures are buffered.** A skeleton view's preload rejecting
  before `mount()` parks on the instance and is flushed once after the first
  render attempt.
- **Cleanup is exactly-once** — subscriptions, descendants, refs, `:outside`
  listeners, portal ranges; a throwing teardown hook cannot block the
  replacement.

**Not funneled:** rethrow-to-caller paths (`beforeMount`, `router.start()`),
explicit guard verdicts, input-capability fallbacks (bad anchors/selectors/
sessionStorage), and event handlers and timers (global reporting path, as in
React/Svelte/Solid). A template function that throws during render is a render
failure and IS contained.

## Alternatives

- Per-view `errorContent(error)` returning ViewNode IR with an ancestor walk —
  IR is not an authoring surface, and the walk forced boundary state on every
  view and router chain invalidation when an ancestor rendered over routed
  descendants.
- A wrapper `<ErrorBoundary>` component — new grammar for what one config key
  expresses.
- Global handler with no fallback UI — leaves the blank hole.
- Widening ctx with the handler — the three-service ctx is a documented
  selling point (D60).

## Consequences

Ordinary views carry no error boilerplate; fallback UI is authored as a normal
view. SPEC §60 documents the phase list and `info` shape.
