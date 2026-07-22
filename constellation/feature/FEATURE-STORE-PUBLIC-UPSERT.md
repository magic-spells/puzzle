---
name: "Public store.upsert() for custom-action responses"
status: verified
verified_at: '2026-07-22T09:00:00.000Z'
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - COMPONENT-STORE
  - DOC-DATASTORE
  - DOC-MODELS
notes:
  - kind: state
    text: >-
      Found by the habit-lab test app (2026-07-22): its checkIn() custom action
      receives fresh server state ({habit, checkin}) but must throw it away and
      re-fetch via two loadOne GETs, because Store._upsert is private.
---

# Public store.upsert() for custom-action responses

## Intent

The documented custom-endpoint idiom — a model method wrapping
`store.request(type, path, opts)` — returns fresh server state and then gives the
caller **no sanctioned way to put it in the store**. Every custom action pays extra
GETs (`loadOne` refreshes) to re-fetch data it is already holding. Promote the
existing merge machinery to the public surface.

## Current shape

`_upsert(type, data)` (`client-runtime/datastore/store.js:349-363`) already does
exactly what's needed and is self-contained: identity-preserving `safeMerge` onto an
existing instance keyed by pk, validation-exempt instantiation otherwise
(server-authoritative, per [[DECISION-D21-ADAPTER-READ-PATH]]), `_synced = true`,
subscriber `_notify`. Its callers (`loadAll` `store.js:316-317`, `loadOne`
`store.js:330-331`) add `_persist()` after. `request()` (`store.js:555-568`) returns
raw parsed JSON and never touches the index.

## Design

**Primary API — `store.upsert(type, data)`** (public):

- Single object: require `data[pk] != null`, route through `_upsert`, then
  `_persist()`; return the record.
- Array: mirror `loadAll`'s per-element shape guard (`store.js:309-315`) — every
  element must be a plain object; upsert each; single `_persist()`; return records.
- **Reject pk-less objects with a clear error.** This is the one sharp edge found in
  research: `_upsert` with a pk-less payload falls through to `_instantiate`, which
  auto-generates a pk and stamps `_synced = true` — a silent phantom "synced" record
  that will PUT to a nonsense URL on next save. The public API must not inherit
  that; require the pk and say so in the error message.

**Convenience — `request(type, path, { merge: true })`** (optional second step):
after `readBody`, route object/array responses through `store.upsert` with the same
guards, then return the parsed body unchanged. Callers keep the raw response (e.g.
habit-lab's `{habit, checkin}` envelope shape would NOT merge — `merge` only makes
sense when the response body IS the record(s); envelope users call `store.upsert`
per key themselves). Document that distinction explicitly in DOC-DATASTORE.

## Semantics to document

- `upsert` means "this came from the server": validation-exempt, `_synced = true`,
  identity-preserving. It is not a general-purpose local write — that stays
  `createRecord`/`update()`.
- Notification batching and persistence behave exactly like `loadOne`.

## Scope

**In:** `store.upsert(type, objectOrArray)` + tests + DOC-DATASTORE/DOC-MODELS
updates (rewrite the custom-endpoint idiom to use it; habit-lab's `checkIn()` is
the reference consumer).
**Out (initially):** the `request({merge})` flag — add after `upsert` proves out;
any offline/queue semantics (explicit non-goals per DOC-DATASTORE).

## Test plan

- Merge path: existing record updated in place (`===` identity), `_synced` set,
  subscribers notified once per flush, persisted.
- Instantiate path: new record appears under server pk.
- Array path: element shape guard rejects non-objects; one persist.
- Guard: pk-less object → throws with actionable message; store unchanged.
- Round-trip with the write path: `upsert` then `save()` issues PUT (not POST).
