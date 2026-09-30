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
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D137 — `loadMany`/`loadOne` require the primary key on every server record

The read-path loaders apply the same primary-key preflight as public
`upsert()`: every element is checked up front, before any upsert, and a
pk-less record throws (`[puzzle] loadMany('todo') requires primary key "id" on
every record`), storing nothing (loadMany is all-or-nothing).

## Context

Without the guard, `_upsert` → `_instantiate` auto-generates an id and marks
the phantom record `_synced`, so its next `save()` PUTs to a URL the server
never had. The loaders already throw loudly on shape violations
(null/array/non-object); the pk hole was the inconsistent one.

## Decision

Both loaders preflight the pk exactly like `upsert()`. Unchanged by design:

- `_instantiate`'s auto-generate stays for storage hydration (`_load`) — that
  path is genuinely fail-soft (a corrupt blob must not crash startup).
- The schema-validation exemption for server records (§20) is untouched —
  this is a shape check, not validation.

Amends the §8 read-path contract (D21). On the
[[DECISION-D161-AUTO-FETCHING-FINDS]] automatic fault path only, `loadOne`
also rejects a response whose pk differs from the requested id under
`recordKey` normalization ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]); an
explicit `store.loadOne()` stays permissive so a lookup by a non-primary key
(a slug) can resolve.
