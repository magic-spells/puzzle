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
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D132 — `save()` and `delete()` serialize behind one per-record write chain

Every server write for a record — `saveRecord` and `deleteRecord` — routes
through one `_chain(record, fn)` helper (D50, SPEC §22). Chains are
module-private WeakMap state in the `/adapter` subpath, keyed by Store then
record, so core carries no write-queue field and a queue is released with its
record.

Why: concurrent `save(); delete()` on a fresh record otherwise either orphans a
server row (DELETE lands first and 404s, then POST creates the row) or silently
no-ops the delete (POST lands first, pk adoption re-keys the record, and the
DELETE built from the old client pk misses). Each chained link reads the
record's state when it reaches the front, so a queued delete uses the pk the save
just reconciled.

## Decision

- **Never-synced `delete()` is a local removal with no request** (the server has
  no row). The delete transport is resolved *first*, so a model with no `delete`
  function or endpoint still reports the missing verb.
- **Already-`_deleted` (or store-less) `delete()` resolves idempotently** with the
  detached record; two concurrent deletes issue one request.
- **`_saveRecordNow` re-checks `_deleted` at run time**: a save queued behind a
  removal rejects with the same message as `record.save()` at call time instead
  of PUT-resurrecting the row. `_deleted` alone is the guard — `removeRecord` is
  the only eviction path and always sets it, while a map-identity check would
  false-positive on a normal first save.
- **Failure semantics:** a prior link's rejection is swallowed for chaining only;
  every caller observes exactly its own promise, across verbs.

## Alternatives rejected

- **A delete-intent flag with a compensating DELETE from save reconciliation** —
  touches every reconciliation branch, adds a third lifecycle flag, and a failed
  compensating DELETE has no caller left to reject.
- **"Await the save chain" in `deleteRecord`** — fixes the happy path only.
