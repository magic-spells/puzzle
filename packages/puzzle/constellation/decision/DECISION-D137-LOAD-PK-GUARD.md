---
name: D137 — loadMany/loadOne require the primary key on every server record
status: verified
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
  - COMPONENT-STORE
  - DOC-SPEC-DATA
  - FILE-STORE
  - FILE-ADAPTER
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D137 — `loadMany`/`loadOne` require the primary key on every server record

The read-path loaders (SPEC §8, D21) apply the same primary-key preflight as
public `upsert()`. Without it, `_upsert` → `_instantiate` auto-generates an id
and marks the phantom record `_synced`, so its next `save()` PUTs to a URL the
server never had.

## Decision

- Every element is checked up front, before any upsert; a pk-less record throws
  (`[puzzle] loadMany('todo') requires primary key "id" on every record`) and
  nothing is stored — `loadMany` is all-or-nothing. `loadOne` throws the same way
  for its one record.
- `_instantiate`'s auto-generate stays for storage hydration (`_load`): that path
  is deliberately fail-soft, because a corrupt blob must not crash startup.
- This is a shape check, not schema validation; the validation exemption for
  server records (§20) is untouched.
- On the [[DECISION-D161-AUTO-FETCHING-FINDS]] automatic fault path only,
  `loadOne` also rejects a response whose pk differs from the requested id under
  `recordKey` normalization ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]). An
  explicit `store.loadOne()` stays permissive so a lookup by a non-primary key
  (a slug) can resolve.
