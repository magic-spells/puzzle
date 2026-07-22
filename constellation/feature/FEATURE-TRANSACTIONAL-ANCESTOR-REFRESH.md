---
name: Transactional reused-ancestor refresh — close the D19/D30 "soft-violation"
status: planned
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D39-SKELETON
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
---

# Transactional reused-ancestor refresh — close the D19/D30 "soft-violation"

Design note (2026-07-14), written after an external review flagged the behavior and an
in-repo repro confirmed it. **Decision deliberately deferred** — this card exists so the
future design session starts from the verified facts instead of re-deriving them.

## Problem (verified, reproducible)

During a gated navigation, reused ancestor views are refreshed with the DESTINATION
params/route inside the pre-commit load batch (`router.js` ~781:
`for (const v of reusedViews) loads.push(v.refresh({ params, route: to }))`).
`PuzzleView.refresh()` sets `#params`/`#route` synchronously and, for a synchronous
`data()`, commits (re-renders) immediately — before `Promise.all(loads)` settles. If a
fresh descendant's `data()` rejects, the catch destroys only the fresh views and returns;
the reused ancestors keep the failed route's data, params, and `this.route` snapshot
(`router.js` ~808: `// stay put, no history entry (reused ancestors kept — soft-violation)`).

Repro: nested `/org/:id` shell, `push('/org/1/home')` then `push('/org/2/bad')` where
`bad`'s `data()` rejects → `router.current` correctly stays `/org/1/home`, but the visible
shell shows ORG 2. [[DECISION-D61-ATOMIC-LOCATION-COMMIT]] made URL/title/stack/scroll
atomic with the mount but explicitly does NOT cover ancestor data/render state.

Acknowledged as an accepted trade-off in [[DECISION-D19-NAVIGATION-COMMIT]],
[[DECISION-D30-NESTED-ROUTES]] ("Accepted soft-violation"), [[DECISION-D47-ROUTE-SNAPSHOT]],
DOC-SPEC §D19 notes, COMPONENT-ROUTER, COMPONENT-PUZZLE-VIEW.

## Proposed shape: two-phase refresh

For reused ancestors in a gated navigation, split `refresh()` into **prepare** (run
`data()` with the new merged params + route snapshot, capture the result AND the store
subscriptions it tracked, render nothing) and **commit** (swap params/route/data/subs and
re-render). The router awaits all gated loads (fresh `data()` + ancestor prepares); only
after ALL resolve does it commit every prepared ancestor synchronously inside the same
`#committing` window as `#commitLocation` + mount — extending D61's atomic block to
ancestor state. On rejection or supersession, prepared results and their tracked
subscriptions are discarded; ancestors are never touched.

## Open design questions (the real work)

- **Subscription lifecycle**: `withTracking` swaps the view's store subscriptions at
  commit today. Prepared-but-discarded runs must unsubscribe anything they tracked
  without disturbing the live subscription set; async-safety interacts with the
  `isDestroyed` liveness probe from the round-1 fix pass.
- **Mid-gate store changes**: a store change during the gate triggers `onStoreChange`
  refresh on the ancestor with the OLD params (correct — old route is still live). Token
  ordering must ensure a prepared commit isn't clobbered by (or doesn't clobber) an
  in-flight old-params refresh.
- **Skeleton interaction** ([[DECISION-D39-SKELETON]]): a skeleton leaf commits navigation
  immediately, but reused ancestors still gate (the one D19 narrowing). Prepared ancestor
  commits must land in that immediate-commit path too.
- **Layout chrome ordering**: D47's reuseLayout reorder (`#commitState` before chrome
  refresh) assumed refresh-commits-immediately; re-verify the ordering under deferred commit.
- **`this.route` invariant** ([[DECISION-D47-ROUTE-SNAPSHOT]]): during prepare, `data()`
  must see the NEW snapshot via `this.route` (unchanged), while the view's committed
  `#route` stays OLD until commit — the prepare/commit split must keep these distinct.

## Rejected alternatives (so far)

- **Rollback after failure** (re-run `data()` with old params in the catch): re-entrant,
  double-renders, side-effecting `data()` runs twice, and a second failure has no floor.
- **Snapshot/restore rendered state**: misses store subscriptions and `#route`; fragile.
- **Status quo forever**: the divergence is user-visible (wrong org rendered) and the
  external review independently flagged it; worth pricing a real fix.

## Acceptance (if built)

- The repro above leaves the shell rendering ORG 1 after the failed nav; `router.current`,
  ancestor `this.route`, params, data, and DOM all agree.
- Superseded-mid-gate navigations discard prepared ancestor state (no leaks — subscription
  count stable across N failed navs).
- Skeleton-leaf navigations, params-only navigations, overlap mode, and flat routes
  byte-identical in behavior to today except the closed hole.
- Amendment gets its own D-number; DOC-SPEC soft-violation language updated; the five
  cards naming the soft-violation re-truthed.
