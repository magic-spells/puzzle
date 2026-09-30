---
name: >-
  D132 — save() and delete() serialize behind one per-record write chain
status: verified
connections:
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - COMPONENT-STORE
  - FILE-STORE
  - DOC-SPEC-DATA
  - FILE-ADAPTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D132 — `save()` and `delete()` serialize behind one per-record write chain

Amends D50 (SPEC §22). Every server write for a record — `saveRecord` and
`deleteRecord` — routes through one `_chain(record, fn)` helper. Chains are
module-private WeakMap state in the `/adapter` subpath, keyed by Store then
record, so core carries no write-queue field and a queue is released with its
record.

## Why

Concurrent `save(); delete()` on a fresh record either orphaned a server row
(DELETE lands first, 404 absorbed, POST then creates the row) or silently no-op'd
the delete (POST lands first, pk adoption re-keys the record, and the DELETE
built from the old client pk misses). Chaining fixes both: each link reads the
record's state when it reaches the front, so a queued delete uses the pk the
save just reconciled.

## Rules

- **Never-synced `delete()` is a local removal with no request** (the server
  has no row). The delete transport is resolved *first*, so a model with no
  `delete` function or endpoint still reports the missing verb.
- **Already-`_deleted` (or store-less) `delete()` resolves idempotently** with
  the detached record; two concurrent deletes issue one request.
- **`_saveRecordNow` re-checks `_deleted` at run time**: a save queued behind a
  removal rejects with the same message as `record.save()` at call time instead
  of PUT-resurrecting the row. `_deleted` alone is the guard — `removeRecord` is
  the only eviction path and always sets it, while a map-identity check would
  false-positive on a normal first save.
- **Failure semantics:** a prior link's rejection is swallowed for chaining only;
  every caller observes exactly its own promise.

## Alternatives

- **A delete-intent flag with a compensating DELETE from save reconciliation** —
  touches every reconciliation branch, adds a third lifecycle flag, and a failed
  compensating DELETE has no caller left to reject.
- **"Await the save chain" in `deleteRecord`** — fixes the happy path only.
