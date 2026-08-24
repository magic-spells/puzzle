---
name: D137 — loadMany/loadOne require the primary key on every server record (v1.64)
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
notes:
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D137 — `loadMany`/`loadOne` require the primary key on every server record (v1.64)

The read-path loaders apply the same primary-key preflight public `upsert()`
has always had: every element is checked up front — before any upsert — and a
pk-less record throws (`[puzzle] loadMany('todo') requires primary key "id" on
every record`), storing nothing (loadMany's existing all-or-nothing posture).

## Context

`upsert()`'s guard documents itself as load-bearing: without it, `_upsert` →
`_instantiate` auto-generates an id and marks the phantom record `_synced`,
so its next `save()` PUTs to a URL the server never had. `loadMany`/`loadOne`
reached the identical hazard through the identical `_upsert` with only
null/array/non-object shape checks — I1 of the 2026-07-27 pass-2 review.
"Fail-soft, server-authoritative" never excused it here: the loaders already
throw loudly on shape violations; only the pk hole was inconsistent.

## Decision

Both loaders preflight the pk exactly like `upsert()`. Unchanged by design:

- `_instantiate`'s auto-generate stays for storage hydration (`_load`) — that
  path is genuinely fail-soft (a corrupt blob must not crash startup) and is
  documented as such.
- Schema-validation exemption for server records (§20) is untouched — this is
  a shape check beside the existing array/object guards, not validation.

Amends the §8 read-path contract (D21); closes the half-fixed hazard D50's
provenance rules documented. On the [[DECISION-D161-AUTO-FETCHING-FINDS]]
automatic fault path only, `loadOne` also rejects a response whose pk differs
from the requested id under `recordKey` normalization
([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]) — an explicit `store.loadOne()`
stays permissive so a lookup by a non-primary key (a slug) can resolve.
