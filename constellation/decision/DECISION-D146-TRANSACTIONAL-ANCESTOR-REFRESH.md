---
name: D146 — transactional reused-ancestor refresh (prepare/commit)
status: built
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D39-SKELETON
  - DECISION-D145-ERROR-BOUNDARIES
  - FEATURE-TRANSACTIONAL-ANCESTOR-REFRESH
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
---

# D146 — transactional reused-ancestor refresh (prepare/commit)

Reused ancestors join the atomic commit block. A gated navigation either lands
completely — URL, history, title, mounted tree, scroll save, **and** every
reused ancestor's params, route snapshot, data, and store subscriptions — or
changes nothing at all. This extends [[DECISION-D61-ATOMIC-LOCATION-COMMIT]]'s
window to the last piece of state that sat outside it.

## Two phases

`PuzzleView.prepareRefresh({ params, props, route })` (router-internal; no
public type surface) runs `data()` against the DESTINATION params and route,
captures the model result and the store subscriptions the run tracked, renders
nothing, and mutates no committed field. It returns
`{ ready, commit(), discard() }`, or null where `refresh()` also no-ops
(destroyed, leaving, or profiler-blocked view).

The router pushes `ready` into the gated `loads` array at the position the old
inline refresh occupied, so store tracking serialization is unchanged.
`#commitState` then calls `commit()` on each prepared ancestor — synchronously,
after `#state` is assigned, inside the same `#committing` window as
`#commitLocation` and the mount. Every exit that does not reach a commit calls
`discard()`: the gate's catch, both token-supersession checks, the SSG-takeover
supersession branch, and `#abandon`.

`commit()` swaps params/props/route, applies the held subscription reconcile,
bumps `#runToken`, and re-renders from the already-computed model — `data()`
never runs twice. `discard()` drops only the subscriptions that run added. A
discard is invisible to the app: no render, no lifecycle hook, no error
boundary, no `onStoreChange` (D145's `phase: 'navigation'` report stays the
single signal for a failed navigation).

## Subscription holding

A prepared run never weakens the live subscription set. Last-good keys stay
subscribed AND the prepared run's keys go live, so the view is transiently
over-subscribed (an extra notify at worst) and a discard can never strand a
mounted view. `Store.withTracking` takes a fourth held-eval channel: a
successful prepared eval parks its reconcile instead of applying it, and the
caller's commit/discard decides direction (commit drops `before \ added`,
discard drops `added \ before`). Scope restore of `_tracking`/`_trackingAdded`
is never deferred — that is stack discipline. A failing eval reconciles
immediately, exactly as before.

`Store._heldKeys` (subscriber → keys owned by uncommitted prepares) fences
those keys from every other eval's garbage collection. Without it a mid-gate
store-change refresh — which correctly runs with the OLD params while the
ancestor still shows the old route — would see the prepared keys in its
pre-eval set, not re-query them, and drop the prepare's subscriptions;
the ancestor would commit subscribed to nothing for the new route and silently
stop reacting. `unsubscribe()` clears held state, so a destroy between prepare
and commit reconciles over an empty set.

## Ordering and visibility

- **Token ordering.** Prepare deliberately does not touch `#runToken`. While
  the gate is open the ancestor legitimately shows the old route, so a
  store-change refresh runs and renders normally with old params; the commit's
  bump supersedes any still in flight, whose params are stale by definition.
- **`this.route` during prepare.** A `#evalScope` field (save/restore stack
  discipline, mirroring `Store._tracking`) makes the `params`/`route` getters
  return destination values inside a prepared evaluation while `#route` and
  `#params` stay committed — [[DECISION-D47-ROUTE-SNAPSHOT]]'s invariant intact
  with nothing to roll back on failure. `#renderNow()` clears and restores
  `#evalScope` around the whole render, so a paint landing while a prepared
  async `data()` is suspended draws committed state.
- **Skeletons.** The [[DECISION-D39-SKELETON]] leaf path commits through
  `#commitState` like every other path, so prepared ancestors land in the
  immediate (un-awaited-leaf) commit where the old inline refresh did.
- **Layout chrome.** D47's `reuseLayout` ordering is unchanged: ancestors
  commit inside `#commitState` after `#state`, so the layout chrome refresh
  still runs last and now also sees ancestors already naming this route.

## Known residual

`#evalScope` persists across a prepared ASYNC `data()`'s awaits, so app code
reading `this.route` from a DOM event handler during that window sees the
destination snapshot. Renders are fenced; handler dispatch is not, and fencing
it would mean wrapping the view manager's listener invocation. Narrow (async
ancestor `data()` + a handler firing mid-gate + reading `this.route`) and noted
at the getter.

## Alternatives rejected

- **Rollback after failure** (re-run `data()` with old params in the catch):
  re-entrant, double-renders, side-effecting `data()` runs twice, and a second
  failure has no floor.
- **Snapshot/restore of rendered state**: misses store subscriptions and
  `#route`; fragile.
- **Bumping `#runToken` at prepare**: would suppress the mid-gate store-change
  refreshes that are correct while the old route is still displayed.
- **Leaving the divergence in place**: the wrong organization's chrome rendered
  under the right URL is user-visible and silent — no throw, no log.
