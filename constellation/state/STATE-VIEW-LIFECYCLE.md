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
      cancel the retained out effect, clear the leaving guard, and refresh to re-establish the
      subscription playOut dropped; the out sequence stays spent
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
verified_at: '2026-08-23T19:55:49.079Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
---

# PuzzleView lifecycle machine

One instance, from construction to teardown. Views, layouts, and reusable
components all run this machine — the only difference is who owns the instance:
the router for a routed view or layout, a parent's patch for a component, the
static kernel for a prerendered page root. Ownership decides the failure
outcome, not the phases.

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

## Two layers of state, one machine

`data()` owns the model layer and replaces it wholesale on every successful
commit — keys an earlier run returned and this one omits disappear. `setData()`
owns a persistent local layer that wins over the model until the next model
commit, and it schedules a render *without* re-running `data()`. That is why
`updating` is reachable two ways that look identical from the DOM and are not
identical from the instance: one re-ran `data()` and re-derived its
subscriptions, one did not. The full re-render trigger table lives in
[[FLOW-REACTIVITY]].

Subscriptions reset on every `data()` run, so an instance is subscribed to
exactly what its latest run actually queried.

## `preloaded` is what makes the navigation commit atomic

A routed instance runs `created()` and `data()` with no ViewManager at all —
there is nothing to render into, and the render inside the refresh no-ops. The
later mount is therefore synchronous, which is the whole point: the router's
commit window cannot contain an await. A component mounted by a parent patch
takes the ordinary asynchronous path instead and reserves its position with a
comment anchor so sibling insertion references stay valid.

`mounted()` is gated on a real first render, not on the mount call returning. If
a parent prop update supersedes the initial async `data()`, mount completion —
and any pending enter animation — defers to the commit that actually renders,
so the hook never receives the comment anchor.

## `preparing` exists so a failed navigation has nothing to roll back

A reused ancestor is already on screen. During a gated navigation its `data()`
must run against the *destination* — that is how it gates the URL, and how
`this.route` names the navigation being gated — while its committed params,
snapshot, model, DOM and live subscription set stay exactly as they are. The
prepared run's scope is visible only to that evaluation; a store-change refresh
landing in the same window still reads committed state.

The handle is idempotent and is discarded unconditionally on the way out, which
is the only thing that covers a throw escaping the router's synchronous commit
block. An unreleased hold fences the ancestor's keys in the store for the rest
of the session.

## `leaving` is inert, and reversible exactly once

`playOut()` unsubscribes the instance immediately and ignores every later
delivery — refresh, setData, store change, parent update. A fading element must
not re-render. The element stays in the DOM for the whole out animation; the
caller removes it.

The one path back is router recovery: when a navigation fails *after* starting
the leave, the outgoing unit is restored — the retained out effect is
cancelled and a refresh re-establishes the subscription. The out sequence stays
spent, so a later navigation away swaps the unit out instantly with no second
animation.

## `failed` describes a position, not a live instance

Reaching `failed` means `destroy()` has already run on this instance. What
survives is the position: a placeholder planted before teardown, holding either
the app `errorView` — an ordinary compiled view receiving `error`, `info`, and
`retry` — or an invisible recovery marker when no error view is configured.
Parent, siblings, and the surrounding layout keep their state.

Retry never returns *this* instance to `mounted`. It rebuilds through the
position's normal owner: the router forces a same-location replace with the
chain marked non-reusable, or a parent's ordinary refresh remounts a fresh
child. Either way a brand-new instance enters this machine at `constructed`.
The face is held for the whole rebuild and released only by something that
immediately refills the position, so a retry can never leave a blank.

The error view itself failing reports once with `phase: 'error-view'` and
stops — the runtime never mounts an error view for an error view.

## Gotchas

- The `loaded` latch never resets. A skeleton is a first-load affordance, not a
  spinner: later refreshes keep the current content on screen until new data
  commits.
- A `mounted()` throw resolves by owner. A component-owned instance is
  destroyed and its position held for the next parent patch; a router-owned one
  stays committed, because the URL already moved atomically and tearing the view
  down would strand a committed URL over an empty container.
- `destroy()` is synchronous, instant, and idempotent, and a throwing
  `destroyed()` hook is caught — the teardown cascade above it must always
  complete.
- An enter animation with a visible trigger holds the element at its `from`
  keyframe and defers the whole show bracket to the reveal. `mounted()` timing
  is unchanged, and every degradation path lands on plain mount behavior so
  content is never stranded hidden.
