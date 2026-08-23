---
name: "record.delete() self-idempotency"
status: verified
verified_at: '2026-08-23T19:55:29.874Z'
connections:
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-DATASTORE
  - DOC-MODELS
  - FILE-ADAPTER
notes:
  - kind: state
    text: >-
      Found by the habit-lab test app (2026-07-22), Sync Lab scenario 5: the
      documented "DELETE treats 2xx and 404 both as success" contract holds at
      store.deleteRecord, but a second record.delete() on the same reference
      rejects locally before any network call.
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
release: RELEASE-V0-1-2
change: fix
---

# record.delete() self-idempotency

## Intent

Deleting an already-deleted record succeeds quietly. That is the spirit of the
D50 contract, and it is what UI code naturally does when two paths — a button
handler and a stale list item, a double-click, a retry — both hold the same
record reference. The alternative was a reject whose message ("never added to a
store") described a different situation entirely and sent readers looking for a
bug in record creation.

## Shape

One non-enumerable `_deleted` flag, declared beside `_synced` in the
`PuzzleModel` constructor (`client-runtime/model.js`), carries the whole
contract. `removeRecord` — which stays in core, `client-runtime/datastore/store.js`
— sets it **before** detaching `_store`, so the flag is the single terminal
state for both local `destroy()` and confirmed `delete()`. Ordering matters:
because `removeRecord` nulls `_store` unconditionally, a guard that tested
`_store` first could never tell "deleted" from "never added".

The server verbs live in the opt-in adapter subpath
(`client-runtime/datastore/adapter.js`), installed onto `Store.prototype` and
`PuzzleModel.prototype` by the capability:

- `delete()` checks `_deleted` first and resolves with the record; only then
  does it reject a store-less record with the never-added message. A freshly
  `new`'d record has `_deleted === false` and `_store === null`, so it still
  takes the reject branch.
- `deleteRecord` queues on the record's write chain; `_deleteRecordNow`
  re-checks `_deleted`/`_store` when its turn arrives, so CONCURRENT double
  deletes resolve with exactly one DELETE reaching the adapter
  ([[DECISION-D132-CROSS-VERB-WRITE-CHAIN]]).
- An identity re-check before `removeRecord` keeps an in-flight delete of A
  from evicting a newer B that reused A's id.
- 404 tolerance is **not** part of this flag's contract. It belongs to the
  endpoint-generated transport, which treats a 404 on `DELETE endpoint/:id` as
  already-gone; an author-supplied `delete` function returning a non-OK
  `Response` rejects with `PuzzleAdapterError` like any other verb.

`save()` reads the same flag: a deleted record rejects with one shared
"cannot save a deleted record" message rather than POSTing a resurrected copy.
The message is defined once in the adapter module because two sites raise it —
`save()` at call time, and `_saveRecordNow` when a queued save discovers the
removal only on reaching the front of the chain — and callers must not be able
to tell those apart.

`destroy()` sets the flag too, by virtue of routing through `removeRecord`:
"this instance is gone" is one concept, and no public path re-adds an existing
instance (`createRecord` always builds fresh), so a stale flag is unreachable
through the documented surface. Being non-enumerable keeps it out of
`toJSON()` and persistence.

## Not in scope

Resurrect/undelete APIs. `store.deleteRecord`'s server-facing semantics were
already correct and are unchanged.

## Coverage

`tests/adapter-write.test.js` pins the matrix: a second delete on the same
removed instance resolving without another request, `destroy()`-then-`delete()`
resolving locally, `save()` after delete rejecting without a POST, the
identity guard against an id-reusing newer record, a never-synced `delete()`
removing locally with no request, two concurrent deletes issuing exactly one
DELETE, and a store-less `delete()` still rejecting asynchronously.
