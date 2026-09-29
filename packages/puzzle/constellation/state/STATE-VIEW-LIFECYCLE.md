---
name: PuzzleView lifecycle machine
status: verified
states:
  - name: constructed
    initial: true
  - name: created
  - name: loading
  - name: preloaded
  - name: skeleton
  - name: mounted
  - name: updating
  - name: preparing
  - name: leaving
  - name: failed
  - name: destroyed
    terminal: true
transitions:
  - from: constructed
    to: created
    action: created() fires from mount() or preload(); class fields such as events are live from here on
  - from: created
    to: loading
    action: >-
      data(params, props) runs inside the store's tracking scope, so its queries become this
      instance's subscriptions
  - from: loading
    to: preloaded
    guard: the router called preload()
    action: data() resolved with no ViewManager — nothing rendered, nothing in the DOM
  - from: preloaded
    to: mounted
    guard: the router mounts inside its synchronous commit window
    action: render the already-resolved model, then mounted()
  - from: loading
    to: skeleton
    guard: the first data() is still pending and renderSkeleton is compiled
    action: render the skeleton into the reserved position and resolve the mount without waiting for data
  - from: skeleton
    to: mounted
    guard: the first data() committed and any anti-flash min-duration hold has expired
    action: flip the loaded latch and patch the real template over the skeleton
  - from: loading
    to: mounted
    guard: data() was synchronous or resolved without being superseded
    action: first tree rendered, then mounted()
  - from: loading
    to: destroyed
    guard: destroy() ran while data() was awaited
    action: >-
      mounted() never fires — a torn-down instance must not re-subscribe, start timers, or take
      focus
  - from: mounted
    to: updating
    action: a store change matching a tracked query, refresh(), setData(), or a parent prop or slot update
  - from: updating
    to: mounted
    action: >-
      beforeUpdate() then patch then afterUpdate(); the previous tree stays on screen until the new
      one commits
  - from: mounted
    to: preparing
    guard: a gated navigation reuses this instance as an ancestor
    action: >-
      prepareRefresh() runs data() against the destination params and snapshot without touching any
      committed field
  - from: preparing
    to: mounted
    guard: the navigation reached its commit window
    action: swap params, route snapshot, model and subscriptions in one step, then re-render
  - from: preparing
    to: mounted
    guard: the navigation failed or was superseded
    action: >-
      discard — drop only the subscriptions this run added; committed params, snapshot, model, DOM
      and subscription set are untouched
  - from: mounted
    to: leaving
    action: >-
      playOut(): unsubscribe immediately and become inert, then viewWillHide() then the out
      animation then viewDidHide()
  - from: leaving
    to: destroyed
    action: the owner removes the element and destroys once the out settles
  - from: leaving
    to: mounted
    guard: the router is recovering a navigation that failed after this leave started
    action: >-
      cancel the retained out effect, clear the leaving guard, fire viewWillShow() then
      viewDidShow() at zero duration to re-open the show bracket playOut() closed, and refresh to
      re-establish the subscription it dropped; the out sequence stays spent
  - from: mounted
    to: failed
    guard: a framework-contained mount, render or refresh failure
    action: >-
      report through the funnel, plant a placeholder at the exact position, destroy this instance,
      then mount the app errorView there
  - from: updating
    to: failed
    guard: a framework-contained render or refresh failure
    action: >-
      same replacement path — an instance whose render just threw is never asked to render its own
      fallback
  - from: failed
    to: destroyed
    action: >-
      the owner releases the position — a navigation away, or a parent patch that no longer renders
      it
connections:
  - STATE-NAVIGATION
  - FLOW-NAVIGATION
  - FLOW-REACTIVITY
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ANIMATIONS
  - COMPONENT-STORE
  - FILE-PUZZLE-VIEW
  - DOC-SPEC-VIEW
  - DOC-VIEW-LIFECYCLE
  - DECISION-D23-REFRESH-PATTERN
  - DECISION-D39-SKELETON
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
  - DECISION-D143-MOUNT-THROW-OWNERSHIP
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D136-VIEW-LIFECYCLE-CONVERGENCE
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D118-LIFECYCLE-HOOK-CONTAINMENT
  - DECISION-D28-ANIMATIONS
  - DECISION-D73-SCROLL-TRIGGER-ANIMATIONS
verified_at: '2026-08-24T18:49:30.658Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# PuzzleView lifecycle machine

One instance, construction to teardown. Views, layouts and components all run it; only
the owner differs (router for routed views/layouts, a parent's patch for components, the
static kernel for a prerendered root), and ownership decides failure outcomes, not phases.
Implementation: [[COMPONENT-PUZZLE-VIEW]].

```mermaid
stateDiagram-v2
  [*] --> constructed
  constructed --> created: created() fires
  created --> loading: data() runs in the tracking scope
  loading --> preloaded: router preload(), off-DOM
  preloaded --> mounted: synchronous mount inside the commit window
  loading --> skeleton: first data() pending, renderSkeleton compiled
  skeleton --> mounted: first data() commits (after any min-duration hold)
  loading --> mounted: data() resolved, first tree rendered
  loading --> destroyed: destroyed while data() was awaited
  mounted --> updating: store change / refresh / setData / parent update
  updating --> mounted: beforeUpdate, patch, afterUpdate
  mounted --> preparing: prepareRefresh() for a gated navigation
  preparing --> mounted: commit — swap params, route, model, subscriptions
  preparing --> mounted: discard — nothing committed changes
  mounted --> leaving: playOut()
  leaving --> destroyed: out settled, owner destroys
  leaving --> mounted: navigation failed, leaver restored
  mounted --> failed: contained mount / render / refresh failure
  updating --> failed: contained render / refresh failure
  failed --> destroyed: owner releases the position
  destroyed --> [*]
```

## Phase notes

- **updating** is reached two ways that look the same in the DOM: a `data()` re-run
  (model layer replaced, subscriptions re-derived to exactly what the run queried) or
  `setData()` (local layer only, no re-run). Trigger table: [[FLOW-REACTIVITY]].
- **preloaded** makes the navigation commit atomic: `created()` + `data()` run with no
  ViewManager, so the later mount is synchronous (the commit window can't await). A
  parent-mounted component instead reserves its position with a comment anchor.
  `mounted()` waits for a real first render — if a prop update supersedes the initial async
  `data()`, completion (and any enter) defers to the render that commits.
- **preparing** (D146) runs `data()` against the destination while committed params,
  snapshot, model, DOM and subscriptions stay untouched; a store-change refresh in the same
  window still reads committed state. The handle is idempotent and discarded
  unconditionally on the way out (the only cover for a throw escaping the commit block); an
  unreleased hold fences the ancestor's store keys for the session.
- **leaving** is inert: `playOut()` unsubscribes and ignores every later delivery; the
  element stays until the caller removes it. It is reversible once — router recovery
  cancels the retained out effect, refreshes to resubscribe, and fires `viewWillShow()` →
  `viewDidShow()` at zero duration to re-open the show bracket `playOut()` closed (hooks are
  lifecycle, D28). The out stays spent, so a later navigation swaps instantly. A throwing
  restore hook is reported, never raised into the router's window, and a `viewWillShow`
  throw doesn't skip `viewDidShow`.
- **failed** is a position, not a live instance: `destroy()` already ran; a placeholder
  holds the app `errorView` (`{ error, info, retry }`) or an invisible marker. Retry never
  revives this instance — the router's same-location replace or a parent refresh builds a
  new one from `constructed`, and the face is held until something refills the position.
  An error view failing reports once as `phase: 'error-view'` and stops.

## Gotchas

- The `loaded` latch never resets: a skeleton is a first-load affordance; later refreshes
  keep current content until new data commits.
- A `mounted()` throw resolves by owner: a component is destroyed and its position held for
  the next parent patch; a routed view stays committed (the URL already moved atomically).
- `destroy()` is synchronous, instant and idempotent; a throwing `destroyed()` is caught so
  the cascade completes.
- A visible-trigger enter holds the element at `from` and defers the show bracket to the
  reveal; `mounted()` timing is unchanged and every degradation path falls back to plain
  mount.
