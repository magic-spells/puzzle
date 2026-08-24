---
name: "Public store.upsert() for custom-action responses"
status: verified
verified_at: '2026-08-24T21:39:15.808Z'
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - COMPONENT-STORE
  - DOC-DATASTORE
  - DOC-MODELS
  - FILE-ADAPTER
notes:
  - kind: state
    text: >-
      Found by the habit-lab test app (2026-07-22): its checkIn() custom action receives fresh
      server state ({habit, checkin}) but must throw it away and re-fetch via two loadOne GETs,
      because Store._upsert is private.
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-1-2
change: feature
---

# Public store.upsert() for custom-action responses

## Intent

The documented custom-endpoint idiom — a model method wrapping
`store.request(type, path, opts)` — returns fresh server state, and the caller
needs a sanctioned way to put it in the store. Without one, every custom action
pays extra GETs (`loadOne` refreshes) to re-fetch data it is already holding.
`store.upsert()` promotes the existing merge machinery to the public surface.

## Shape

`store.upsert(type, objectOrArray)` is installed by the `/adapter` capability
alongside the other server verbs (`client-runtime/datastore/adapter.js`); it is
not on the core Store. It routes through the same private merge the loaders
use: identity-preserving `safeMerge` onto an existing instance keyed by pk,
validation-exempt instantiation otherwise (server-authoritative, per
[[DECISION-D21-ADAPTER-READ-PATH]]), `_synced = true`, subscriber notify.

- A single object returns the record; an array returns records and persists
  once for the whole batch.
- Every payload must be a plain object carrying a non-null primary key, and an
  array is preflighted in full before any element is applied — so a bad element
  cannot half-apply the batch.
- **The pk guard is load-bearing, not defensive.** The private merge with a
  pk-less payload falls through to `_instantiate`, which auto-generates a key
  and stamps `_synced = true` — a phantom "synced" record whose next `save()`
  PUTs to a URL the server never issued. The public API refuses that and says
  why. The same guard was later extended to the loaders
  ([[DECISION-D137-LOAD-PK-GUARD]]).
- Unlike the loaders, `upsert` does **not** take the D125/D138 revision gate: it
  is an explicit imperative call whose caller intends the payload to land, so it
  stays an unconditional overwrite.

## Semantics

`upsert` means "this came from the server": validation-exempt, `_synced = true`,
identity-preserving. It is not a general-purpose local write — that stays
`createRecord`/`update()`. Notification batching and persistence behave exactly
like `loadOne`.

Envelope responses stay explicit. `store.request()` returns the parsed body and
never touches the index, so a `{ habit, checkin }` payload is applied with one
`upsert` per key. A `request(..., { merge: true })` convenience was considered
and not built: `merge` only makes sense when the response body *is* the
record(s), which is the case the caller can already express in one line, and the
envelope case — the one that actually motivated this feature — would not be
served by it.

## Coverage

`tests/store.test.js` — the "Store — public server-authoritative upsert
(D21/D50)" group: the merge path preserving object identity, upsert remaining an
unconditional overwrite after a local edit, and array upserts applying in order
with a single persist. `tests/adapter-write.test.js` pins the provenance
round-trip (a record from public upsert is synced, so its first `save()` PUTs)
and that an upsert of an existing record keeps its prototype and `_store` with
no pollution. `tests/adapter-custom.test.js` covers the documented idiom of a
custom adapter method composing with `upsert`.
