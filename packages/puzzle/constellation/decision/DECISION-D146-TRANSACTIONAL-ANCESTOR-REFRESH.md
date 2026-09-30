---
name: D146 — transactional reused-ancestor refresh (prepare/commit)
status: verified
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D39-SKELETON
  - DECISION-D145-ERROR-BOUNDARIES
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/router/router.js
  - client-runtime/datastore/store.js
  - client-runtime/datastore/adapter.js
  - client-runtime/views/viewManager.js
  - client-runtime/devtools.js
---

# D146 — transactional reused-ancestor refresh (prepare/commit)

## Context

[[DECISION-D61-ATOMIC-LOCATION-COMMIT]] makes a gated navigation land URL,
history, title, mounted tree and scroll save together or not at all. Reused
ancestors refreshed inline, outside that window, so a failed or superseded
navigation could leave an ancestor showing the destination's params, data and
subscriptions under the old URL.

## Decision

Reused ancestors join the atomic commit through two phases.

**Prepare.** `PuzzleView.prepareRefresh({ params, props, route })`
(router-internal, untyped) runs `data()` against the destination, captures the
model and the tracked subscriptions, renders nothing, and mutates no committed
field. It returns `{ ready, commit(), discard() }`, or null where `refresh()`
would no-op (destroyed, leaving, dev-profiler-blocked). The router pushes
`ready` into the gated `loads` array where the inline refresh sat.

**Commit / discard.** `#commitState` calls `commit()` on each prepared ancestor
synchronously after `#state` is assigned, inside the `#committing` window.
`commit()` swaps params/props/route, applies the held subscription reconcile,
bumps `#runToken`, and re-renders from the computed model — `data()` runs once.
Every non-committing exit calls `discard()` (gate catch, token supersession,
SSG-takeover supersession, `#abandon`), and `#navigate` wraps the load phase
and `#swap` in a `finally` that discards every handle, so even a user
`render()`/`afterUpdate()` throw cannot strand holds. Handles are idempotent
(`settled`). A discard is invisible to the app: no render, hook, error view or
`onStoreChange`; D145's `navigation` report is the only signal.

**Commit conflict.** Prepare captures `#runToken` but does not bump it, so
mid-gate store-change refreshes run normally with the old params (correct —
the old route is on screen). If commit finds the token moved, it lands
params/route/subscriptions, bumps the token and converges through `refresh()`
instead of committing the older model (one extra `data()` run).

**Subscription holding.** A prepared run never weakens the live set: old keys
stay subscribed and the run's keys go live (transient over-subscription, an
extra notify at worst). `Store.withTracking` has a held-eval channel: a
successful prepared eval parks its reconcile; commit drops `before \ added`,
discard drops `added \ before`. `_tracking` scope restore is never deferred. A
failing eval reconciles immediately.
- The pending object records the verdict whether or not the eval finished. An
  async `data()` that publishes its reconcile after a discard releases its
  holds at once; after a commit, adopts them at once.
- `Store._heldKeys` (subscriber → `Map<key, {count, adopted}>`) fences held
  keys from other evals' garbage collection. Holds are refcounted over every
  key the eval queried, so overlapping prepares compose; reconciles skip keys
  with a nonzero count, and each outcome releases only its own holds. A
  committing prepare marks keys `adopted` while other holds remain, so a
  loser's later discard treats them as committed. `unsubscribe()` clears held
  state.
- DevTools `snapshot:subscriptions` adds a `held` map beside `byKey`/`byView`
  so an open navigation doesn't read as a leak.

**Destination scope.** Inside a prepared eval the `params`/`route` getters
return destination values while `#params`/`#route` stay committed (D47 intact).
Each invocation (withTracking may retry a sync-shaped async run) installs its
own scope copy in `#evalRuns`; `#evalScope` is the newest in-flight run, and
retiring one falls back to the newest remaining, so an abandoned run is never
resurrected. `#withCommittedScope(fn)` nulls `#evalScope` for the dynamic
extent of the outermost fence (`#fenceDepth`) and then restores the newest
in-flight run. Fenced: renders, DOM event dispatch (the view manager wraps
each patch-managed listener via `__withCommittedScope`), `flushUpdates`/
`setData`, `refresh()`/`onStoreChange()`, and `mounted`/`destroyed`.

**Ordering.** Skeleton leaves ([[DECISION-D39-SKELETON]]) commit through
`#commitState` too. D47's `reuseLayout` refresh still runs last and sees
ancestors already on the new route.

## Known residuals

- App-scheduled closures (`setTimeout`, `fetch().then`, a captured `this`)
  started during an async prepared `data()` read the destination scope; so
  does code after a synchronous `router.push()` in the same frame that began a
  run. No browser primitive gives async-local scope.
- Slot-forwarded handlers are fenced against the RECEIVING manager's owner,
  not the authoring view, so during a pending params-only navigation a
  handler authored in one view but rendered in another reads the destination
  from `this.params`/`this.route`. Mitigation: take ids from the rendered model
  or props. Fix (not built): carry the authoring view on the forwarded vnode so
  the listener installer fences the author.

## Alternatives

- Rollback after failure (re-run `data()` with old params) — re-entrant,
  double-renders, side-effecting `data()` runs twice, no floor on a second
  failure.
- Snapshot/restore rendered state — misses subscriptions and `#route`.
- Bump `#runToken` at prepare — suppresses correct mid-gate store refreshes.
- Commit the prepared model unconditionally — clobbers a mid-gate store
  refresh with pre-edit data.
- Pass the destination as an explicit `data()` argument — closes the closure
  residual but breaks the D47 `data()` contract and every app's signature.

## Consequences

A gated navigation lands every reused ancestor's params, route, data and
subscriptions with the URL, or changes nothing.
