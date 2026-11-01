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
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D188-TICK
verified_at: '2026-11-01T19:26:46.557Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Reactivity flow

Two intentionally asymmetric update paths:

1. **Model path**: a store notification, prop change or route-param change reruns
   `data(params, props)`. The settled result REPLACES the model layer, then the
   view renders and patches.
2. **Local path**: `setData()` writes the persistent local layer and schedules a
   render without rerunning `data()`; call `refresh()` when derived model data must
   recompute.

Implicit two-way binding ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]) uses both: a
bound local writes through `setData` + `refresh`; a bound record writes through
validated `update()`, which comes back as a store notification. The
controlled-property echo compares against the live DOM, so a keystroke patches
nothing back.

## Steps

1. Queries inside `data()` subscribe the view in [[COMPONENT-STORE]]; each run
   replaces the previous subscriptions. With the adapter capability, a tracked
   miss queues a fetch and the run repeats until it settles; only the final warm
   pass's subscriptions commit, and a notification during an open settle window
   folds in as one more pass ([[DECISION-D161-AUTO-FETCHING-FINDS]]).
2. A mutation (`createRecord`, `update()`, adapter upsert, removal) notifies
   record and collection keys and stamps the record's render revision; keys batch
   into one flush on the shared frame scheduler ([[DECISION-D63-HIDDEN-TAB-FLUSH]]).
3. The flush delivers each subscriber once, isolated from failures. Async `data()`
   is last-wins. A `data()` whose tracked find misses returns a promise; a sync
   hit-only first pass stays sync, which decides whether a skeleton shows
   ([[COMPONENT-PUZZLE-VIEW]]).
4. Render → diff → keyed patch in [[COMPONENT-VIEW-MANAGER]]. Children with equal
   props bail out; list blocks return cached rows whose inputs didn't change;
   placeholders keep conditional child arity stable.

`this.renderTick()` resolves when steps 2–4 have drained everywhere
([[DECISION-D188-TICK]]); `app.idle()` also waits for async `data()`, fetches,
navigation and locale loads ([[DECISION-D185-APP-IDLE]]).

**One flush, one `data()` run.** A child that both receives a record prop and
queries it would be woken twice (parent's `applyParentUpdate` + its own
`onStoreChange`). A refresh started inside delivery stamps the batch sequence on
`_settleMark`, and the child's own notification takes the `seq <= _settleMark`
early return ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]).

## What a record prop observes

Records mutate in place, so a record prop compares by **render revision** as well
as reference: `<TodoItem todo={todo}/>` refreshes when that record changes through
`update()` or any store path. Not covered: a related record's fields, a computed
getter's inputs, a deep path, or a direct field assignment (`todo.title = 'x'`,
which the store never sees). For those, pass identity and re-query in the child's
own `data()`. `{#for}` row caching follows the same boundary; its rules are
[[DOC-SPEC-TEMPLATE]] §28.

## Cost

Propagation is O(1) in depth and forest size: updating any node of a deep tree
reruns `data()` only on that node, because children bail out on equal props
([[DOC-STRESS-EXAMPLE]] `deep-nest`). The unbounded cost is async `data()`, which
serializes store-wide ([[COMPONENT-STORE]]).
