---
name: >-
  D132 — save() and delete() serialize behind one per-record write chain
status: verified
connections:
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - FEATURE-ADAPTER-WRITE-SYNC
  - FEATURE-DELETE-IDEMPOTENCY
  - COMPONENT-STORE
  - FILE-STORE
  - DOC-SPEC-DATA
  - FILE-ADAPTER
verified_at: '2026-08-23T19:55:17.450Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
notes:
  - kind: verified
    text: >-
      Verified at the merged release/0.4.0 tip (PR #38): _chain/_writeChains semantics, both delete
      early-outs, and the _saveRecordNow run-time _deleted guard reviewed line-by-line against
      store.js; six cross-verb tests plus the retimed mid-flight guards green (vitest 1439/1439 at
      the merge commit).
    sha: f2bf7b6ab1c0487ce458b48443b62b447ff55ff6
---

# D132 — save() and delete() serialize behind one per-record write chain

Amends §22/D50. The per-record in-flight chain that already serialized
concurrent `save()`s now serializes **every server write** for a record:
`saveRecord` and `deleteRecord` both route through one extracted
`_chain(record, fn)` helper. The chains are module-private `WeakMap` state in
the `/adapter` subpath — keyed by Store, then by record — so core carries no
write-queue field and a record's queue is released with the record.

## The race this closes

`deleteRecord` used to dispatch immediately, so `save(); delete()` on a fresh
record ran POST and DELETE concurrently, and both orderings were wrong:

- **DELETE lands first:** the DELETE 404s (absorbed as idempotent by the
  generated transport), local removal succeeds — then the still-in-flight POST
  creates the row server-side. A server orphan, with `save()` resolving as if
  nothing happened.
- **POST lands first (worse):** pk adoption re-keys the record, but the DELETE
  was built from the old client pk. Its §22 identity guard then misses at the
  vacated key, so nothing is removed anywhere — and `delete()` **resolves
  successfully**. A silent no-op delete.

Chaining fixes the second case with no delete-side code: each link reads the
record's state when it *reaches the front of the queue*, so a queued delete
builds its URL from the pk the save just reconciled.

## Companion guards (same change)

- **Never-synced `delete()` is a local removal with no request.** The server
  has no row; the old unconditional DELETE could only 404 — or worse, reject
  with a 4xx on an id the server never issued, stranding a record the app had
  already discarded. The delete transport is *resolved first*, before this
  short-circuit, so a model with neither a `delete` function nor an endpoint
  still reports its missing verb rather than quietly behaving like `destroy()`.
- **Already-`_deleted` (or store-less) `delete()` resolves idempotently** with
  the detached record — two concurrent `delete()`s issue exactly one request.
- **`_saveRecordNow` re-checks `_deleted` at RUN time.** A save queued behind
  another write can outlive its record (a `destroy()` or removal landing while
  it waited); it now rejects with the same message `record.save()` gives at
  call time instead of PUT-resurrecting the server row. `_deleted` alone is the
  whole guard: `removeRecord` is the only path that evicts from the type map
  and it always sets the flag, while a map-identity check could false-positive
  a normal first save (which IS indexed under its client key pre-POST).

## Failure semantics

Unchanged from the D50 save-save contract, now stated across verbs: the prior
link's rejection is swallowed for chaining only — a queued delete does not
inherit a failed save's rejection, and every caller observes exactly its own
promise.

## Rejected

- **Delete-intent flag with a compensating DELETE from save reconciliation** —
  lets `delete()` resolve without waiting on the in-flight POST, but touches
  all four reconciliation branches, adds a third lifecycle flag beside
  `_synced`/`_deleted`, and has no error channel for a failed compensating
  DELETE (its caller already resolved). Nothing needed the earlier resolve.
- **A one-line "await the save chain" in deleteRecord** — serializes the happy
  path but defines no semantics for never-synced records, double deletes, or a
  queued save discovering the removal; the failure cases were the bug.
