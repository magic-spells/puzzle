---
name: store.observe — observe records from outside a view
status: built
release: RELEASE-V0-9-0
change: feature
branch: feat/store-observe
connections:
  - DECISION-D184-STORE-OBSERVE
  - COMPONENT-STORE
  - FILE-STORE
  - DOC-DATASTORE
  - DOC-SPEC-DATA
  - DOC-RELEASE-SURFACE
---

# store.observe — observe records from outside a view

```js
const stop = store.observe('task', fn);      // any task created, updated or removed
const stop = store.observe('task', id, fn);  // one record
```

The design and its rationale are [[DECISION-D184-STORE-OBSERVE]].

## Scope

- `Store.prototype.observe` in `client-runtime/datastore/store.js`: one method reusing `subscribersByKey`, `keysBySubscriber`, `_dropSubscription` and the batched delivery.
- `types/index.d.ts`: `observe` (two overloads) and `flush` on `Store`; `tests-types/consumer.ts` covers both forms and a missing callback.
- Comments in `store.js` delivery and [[COMPONENT-STORE]] that named a nonexistent `store.subscribe(fn)` now describe observe.
- Docs: [[DOC-DATASTORE]], [[DOC-SPEC-DATA]] §8, [[DOC-RELEASE-SURFACE]], CHANGELOG 0.9.0.

## Tests

`tests/store-observe.test.js`: type-level and record-level create/update/remove, a record observed before it exists with a string id against a number key, one call per flush, `stop()` idempotency and index cleanup, the same function observed twice, error isolation, stopping self and a sibling inside a callback, independence from the tracking scope it is called in, dev argument errors, no fetch on an adapter app, and observe through a view's per-view handle inside its own tracked run. `tests/devtools-bridge.test.js` checks `snapshot:subscriptions` shows the observer as `'fn'`.

## Out of scope

AgentKit's `watch.js` moves to `store.observe` after 0.9.0 is published, in its own repo.
