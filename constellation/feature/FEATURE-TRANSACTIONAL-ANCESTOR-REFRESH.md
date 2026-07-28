---
name: Transactional reused-ancestor refresh
status: built
connections:
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D39-SKELETON
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
---

# Transactional reused-ancestor refresh

Reused ancestors are part of the atomic navigation commit: a gated navigation
moves URL, history, title, mounted tree, scroll save, and every reused
ancestor's params/route/data/subscriptions together, or moves nothing.
[[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]] holds the mechanism and the
rationale; this card is the behavioral summary and the regression contract.

## Behavior

A reused ancestor's `data()` runs during the gate against the destination
params and route snapshot (`this.route`/`this.params` name the destination
inside that run — the D47 invariant), but the ancestor renders nothing and
changes no committed field until the router's commit window. A rejection or
supersession discards the prepared run — subscriptions only — leaving the
ancestor's committed params, snapshot, data, DOM, and live subscription set
untouched.

The shape this closes: a nested `/org/:id` shell at `/org/1/home`, pushing
`/org/2/bad` whose `data()` rejects. `router.current` correctly stays at
`/org/1/home`; the shell now renders ORG 1 with it, where it previously kept
the failed route's params and rendered ORG 2 under the org-1 URL — silent, with
no throw and no log.

## Regression contract

Pinned by `tests/router-ancestor-transaction.test.js`:

- the repro above leaves the shell on ORG 1, with `router.current`, ancestor
  `this.route`, params, data, and DOM all agreeing;
- destination params/route are visible inside the prepared `data()` run while
  committed state stays old;
- a successful navigation moves the ancestor exactly as before;
- N consecutive failed navigations leave the subscription count stable and leak
  no destination-route keys;
- a navigation superseded mid-gate discards its prepared runs.

Skeleton-leaf, params-only, overlap-mode, and flat-route navigations are
unchanged — the existing router suites are that half of the net.

## Residual

`#evalScope` persists across a prepared async `data()`'s awaits. Renders, DOM
event dispatch, `flushUpdates`, `refresh`/`onStoreChange`, and the
`mounted`/`destroyed` hooks are all fenced through `#withCommittedScope`, so
mid-gate app code reads the committed route; only closures app code itself
schedules from inside the gate (`setTimeout`, `fetch().then`) escape the
fence. Documented in D146.
