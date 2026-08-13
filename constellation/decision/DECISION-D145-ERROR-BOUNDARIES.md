---
name: D145 — app-level onError + the app error view (errorView)
status: built
connections:
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
  - DECISION-D136-VIEW-LIFECYCLE-CONVERGENCE
  - DECISION-D143-MOUNT-THROW-OWNERSHIP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
---

# D145 — app-level `onError` + the app error view (`errorView`)

The app-facing error story on top of the D115/D136/D143 recovery machinery.
It preserves position ownership while superseding D115/D143's router-preloaded
teardown exemption, and gives the existing catch sites one reporting funnel
and one replacement-render face. Before it,
every contained failure dead-ended in `console.error` and the user saw a blank
hole.

## The funnel (`client-runtime/errors.js`)

Every framework-contained app error reports through `reportError(ctx, error,
info, ...consoleArgs)`. `new PuzzleApp({ onError })` registers the hook;
without one, the funnel replays the exact `console.error` call the catch site
always made. The hook receives `(error, info)` with a frozen stable
`info = { phase, view, route }` — phases include `mount`, `refresh`,
`navigation`, `transition`, `leave`, `bind`, and `error-view`. A throwing (or
rejecting async) `onError` is contained at the funnel with its own
`console.error` and never re-enters the funnel. The handler lives in a WeakMap
keyed by ctx — the documented three-service ctx object is NOT widened.

## The app error view (`errorView`)

`new PuzzleApp({ errorView })` registers ONE ordinary compiled view — the
default export of any `.pzl` file, typically `app/views/AppError.pzl`. There is
no dedicated grammar, no per-view error member, and ordinary views carry zero
error boilerplate; fallback UI is authored in template markup like every other
pixel. A value that is not a view constructor is a construction-time config
error. The constructor is stored beside `onError` in the ctx-keyed WeakMap.

When a framework-contained mount/refresh failure lands, the runtime — after
the funnel report — replaces the failed view at its exact position with a
fresh instance of the error view. Parent, siblings, and the surrounding layout
stay mounted and keep their state. The error view is a normal `PuzzleView`
(own `data()`, `events`, styles) receiving props:

- `error` — the failure as thrown.
- `info` — the same frozen `{ phase, view, route }` the funnel passed for this
  failure (no second route representation is invented).
- `retry` — a callback, identity-stable for the error view's lifetime.

**Replacement, never re-render.** The error view is a fresh instance mounted
where the failed view stood; the broken instance is destroyed first. An
instance whose `data()` or render just threw is never asked to render its own
fallback face.

**Explicit retry.** `retry()` destroys the error view and reconstructs the
ORIGINAL view from scratch — constructor, `created()`, `data()`, render,
mount — from the owner-captured constructor, props, slot children, and route
inputs. Single-flight: calls during an active attempt are ignored. If the
parent's patch or a navigation already replaced the position, retry is a
no-op. A failed retry reports through the funnel and mounts a fresh error view
carrying the new error. Nothing retries automatically, ever.

**Ownership follows the failed position.** A failed child component's
replacement is owned by the parent's patch — a later patch that removes or
replaces the original component removes the replacement with it, and keyed
reorders cannot strand it. A failed routed view's replacement sits in the
route container and is owned by the router: navigating away tears it down
normally, and a failed chain is never reused. Because replacement always lands
AT the failed position — never at an ancestor — no ancestor can render over
router-owned descendants, and no router chain-invalidation path exists for
error rendering.

**The error view failing** (its own `data()`, render, or mount) reports once
with `phase: 'error-view'` and stops — the runtime never mounts an error view
for the error view. The failed-mount placeholder stays, so a later parent
update or navigation recovers the position.

**SSG takeover:** when a takeover mount fails, the error view renders first;
only when none is configured (or it failed) is the prerendered page restored
exactly as before.

**No `errorView` configured:** the funnel still reports every failure, the
failed position keeps the invisible recovery placeholder, and the owner's
`refresh()` retries through the normal placeholder re-mount. No built-in
styled error UI ships.

**Prerender (both output modes):** a build-time failure fails the build. The
error view never renders into generated HTML, and no server error object is
serialized into page output.

## Rendering invariants (the retained recovery floor)

- **Never patched over an unknown tree.** This is an invariant of the MANAGER,
  not of the error path: `ViewManager.render()` routes to `renderFresh()`
  whenever `treeUnknown` is set. A throw partway through a `patch()` leaves
  the DOM matching neither the old nor the new tree, so the manager marks its
  tree UNKNOWN (bracketing the managed range with the live siblings outside
  it, the only trustworthy handles) and renders fresh: release BOTH aborted
  trees' non-DOM resources first (the trees lie about where nodes are, not
  about what exists — nested instances, refs, `@event:outside` document
  listeners, and portaled content all outlive raw node removal; the release
  walk is guarded per tree so a throwing user hook cannot stop the fresh
  mount, and `clear()` runs the same release so a destroy reaches both trees),
  then clear the bracketed range by DOM removal and mount fresh. Healthy
  renders keep the cheap diff path.
  **Known limit — the unbracketed case.** Bracketing needs the old tree's root
  to be a direct child of the manager's container. When it is not (a component
  or portal root whose node lives elsewhere, or a tree with no `el` yet),
  `unknownRange` is null: `renderFresh` removes nothing and mounts with a null
  insertion ref, so fresh content can land beside the corrupt content rather
  than replacing it. Recovering a range with no trustworthy handle needs a
  decision this card does not yet make; what is settled is that a fresh mount
  showing current state beats a frozen tree patched over orphans.
- **A pre-mount failure is buffered, not lost.** A skeleton view's un-awaited
  preload can reject before `mount()` creates the view's ViewManager; the
  error parks on the instance and `mount()` flushes it once after the first
  render attempt — no double-fire.
- **Cleanup is exactly-once.** Replacing a failed view releases its store
  subscriptions, destroys descendants once, clears refs once, removes document
  `@event:outside` listeners, and removes portaled content and ranges; a user
  teardown hook that throws cannot prevent the replacement from mounting.

## Deliberate exclusions (not funneled)

Rethrow-to-caller paths (`beforeMount`, `router.start()` — the `mount()`
caller owns those), explicit navigation verdicts (a guard returning false),
input-capability fallbacks (invalid anchors/selectors/session-storage), and
event handlers/formatters, which surface uncaught as ever. UI error
containment stays scoped to rendering/updating work, matching the
boundary scope React, Svelte, and Solid settled on — browser event and timer
errors belong to the global reporting path.

## Alternatives rejected

- **Per-view `errorContent(error)` members returning ViewNode IR** (nearest
  ancestor wins, `null` declines outward, a throwing boundary continues the
  walk): `ViewNode` is compiler intermediate representation, not an authoring
  surface — hand-nesting IR to describe error UI contradicts the framework's
  own templating model. The hierarchy also made every view carry
  boundary-discovery state, split the fallback face's ownership across
  failed/ancestor instances, and forced a router chain-invalidation path
  whenever an ancestor boundary rendered over router-owned descendants. One
  app-level replacement view deletes the walk, the decline/cascade semantics,
  and that invalidation while keeping local containment.
- **A wrapper `<ErrorBoundary>` component**: new grammar and marker surface
  for what one config key expresses.
- **Global-only handler with no fallback UI**: closes the reporting gap but
  leaves the blank-hole UX that motivated the feature.
- **Widening ctx with the handler**: the three-service ctx is a documented
  selling point (D60 re-rejection); the WeakMap keeps the surface intact.
- **Keeping `errorContent` alongside `errorView`**: dual APIs retain the walk
  and cascade machinery the redesign exists to delete.
