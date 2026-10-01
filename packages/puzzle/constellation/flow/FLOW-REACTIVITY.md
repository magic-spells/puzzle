---
name: Reactivity flow
status: verified
triggers:
  - { kind: event }
  - { kind: manual }
connections:
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-MODEL
  - FILE-STORE
  - FILE-PUZZLE-VIEW
  - FILE-VIEW-MANAGER
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D161-AUTO-FETCHING-FINDS
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Reactivity flow

Two intentionally asymmetric update paths:

1. **Model path**: a store notification, prop change or route-param change reruns
   `data(params, props)`. The settled result REPLACES the model layer, then the component
   renders and patches. A notification during an open D161 settle window folds into that
   run as one more pass (`_settleDirty`).
2. **Local path**: `setData()` writes the persistent local layer and renders immediately
   without rerunning `data()`; call `refresh()` when derived model data must recompute.

Implicit two-way binding ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]) uses both: a bound
local writes through `setData` + `refresh`; a bound record writes through validated
`update()`, which re-enters as a store notification. The controlled-property echo
compares against the live DOM, so the keystroke patches nothing back.

## Steps

1. Queries inside `data()` register the view with [[COMPONENT-STORE]]. With the adapter
   capability, a tracked miss queues a fetch and the evaluation re-runs until it settles;
   only the final warm pass's subscriptions commit ([[DECISION-D161-AUTO-FETCHING-FINDS]]).
2. A mutation (`createRecord`, `update()`, adapter upsert, removal) notifies record and
   collection keys and stamps the record's render revision; keys batch into one flush.
3. `flush()` delivers each subscriber once, isolated from failures. Async `data()` is
   last-wins; a `data()` whose tracked find misses returns a promise (a sync hit-only first
   pass stays sync, which decides whether a skeleton shows — [[COMPONENT-PUZZLE-VIEW]]).
4. Render → diff → keyed patch in [[COMPONENT-VIEW-MANAGER]]. Children with equal props
   bail out; list blocks return cached rows whose inputs didn't change; conditional
   placeholders keep child arity stable.

**One flush, one `data()` run**: a child that both receives a record prop and queries it
would be woken twice (parent's `applyParentUpdate` + its own `onStoreChange`). A refresh
started inside delivery stamps the batch sequence on `_settleMark`, and the child's own
notification takes the `seq <= _settleMark` early return
([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]).

## What a record prop and a row cache observe

Records mutate in place, so a record prop compares by **render revision** as well as
reference: `<TodoItem todo={todo}/>` refreshes when that record changes through `update()`
or any store path. NOT covered: a related record's fields, a computed getter's inputs, a
deep path, or a direct field assignment (`todo.title = 'x'` — which the store never
observed anyway). For those, pass identity and re-query in the child's own `data()`.

`{#for}` row caching follows the same boundary:

- Record rows cache on reference + revision (+ index if the body reads the counter, + any
  parent `data()` roots the body reads).
- Plain objects and arrays never cache (no revision to compare).
- Conservative sites (a relation, computed getter or deeper path in the body) never cache
  record rows; the block checks the read fields once per model class against the schema
  and a dev counter reports it.

## Measured

Propagation is O(1) in depth and forest size ([[DOC-STRESS-EXAMPLE]] `deep-nest`, 1,536
nested views): updating the deepest or shallowest node of a branch runs `data()` on 1 of
1,536 views (the child bails out on equal props); the control — a record every node
queries — runs 1,536. The unbounded cost is async `data()` serializing store-wide
([[COMPONENT-STORE]]).
