---
name: "record.delete() self-idempotency"
status: verified
verified_at: '2026-07-22T09:00:00.000Z'
connections:
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-DATASTORE
  - DOC-MODELS
notes:
  - kind: state
    text: >-
      Found by the habit-lab test app (2026-07-22), Sync Lab scenario 5: the
      documented "DELETE treats 2xx and 404 both as success" contract holds at
      store.deleteRecord, but a second record.delete() on the same reference
      rejects locally before any network call.
---

# record.delete() self-idempotency

## Intent

Deleting an already-deleted record should succeed quietly — that is the spirit of
the D50 contract ("2xx and 404 both count as success"), and it is what UI code
naturally does when two code paths (a button handler and a stale list item, a
double-click, a retry) both hold the same record reference. Today the second
`record.delete()` rejects with a misleading error that suggests the record was
never real.

## Current shape

- `deleteRecord` (`client-runtime/datastore/store.js:520-546`) is properly
  idempotent against the **server** (404 tolerated, `store.js:533`) and against
  **store races** (identity re-check at `store.js:540` before `removeRecord`).
- But `removeRecord` (`store.js:282-290`) sets `record._store = null`, and
  `record.delete()` (`model.js:482-489`) rejects any store-less record with
  "cannot delete() a store-less record — create it via store.createRecord() first"
  — an async reject **before any network call**. The guard cannot tell "deleted"
  from "never added".

## Design

Add a non-enumerable `_deleted` flag beside `_synced` in the model constructor
(`model.js:318-322`), and check it **first** in `delete()`:

```js
delete() {
  if (this._deleted) return Promise.resolve(this);   // idempotent success
  if (!this._store) return Promise.reject(new Error('…never added…'));
  return this._store.deleteRecord(this);
}
```

Set `_deleted = true` on the confirmed-delete ack path in `deleteRecord`
(`store.js:540-542`, alongside `removeRecord`). Because `removeRecord` nulls
`_store` unconditionally, checking `_deleted` before `_store` is exactly what makes
the second call resolve instead of reject.

**Decision to make during implementation:** does `destroy()` (local-only removal,
`model.js:454-457` → `removeRecord`) also set `_deleted`? Recommendation: set it in
`removeRecord` itself, so `destroy()`-then-`delete()` resolves too — "this instance
is gone" is one concept, and there is no public path that re-adds an existing
instance (createRecord always builds fresh), so a stale flag is unreachable through
the documented surface. Non-enumerable keeps it out of `toJSON()` either way.

The never-added case is preserved by flag ordering: a `new`'d record has
`_deleted === false` and `_store === null` → still rejects with the (reworded)
"never added" message.

## Scope

**In:** `_deleted` flag, `delete()` short-circuit, `save()` after delete should
also reject clearly ("cannot save a deleted record") rather than POST a resurrected
copy — audit `save()`'s store-less guard message at `model.js:467-474` in the same
pass; tests; DOC-MODELS + DOC-DATASTORE contract note.
**Out:** resurrect/undelete APIs; changing `store.deleteRecord`'s existing
semantics (already correct).

## Test plan

- create → save → delete → delete again: second resolves, store still empty, no
  second network request beyond the first pair.
- delete on a never-added `new` record: rejects with the never-added message.
- destroy() → delete(): per the decision above (resolve, if flag lives in
  removeRecord).
- save() after delete: rejects, no POST fired.
- Habit-lab Sync Lab scenario 5 (the origin repro) passes against the new build
  without its store-level workaround.
