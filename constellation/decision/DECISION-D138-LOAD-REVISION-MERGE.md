---
name: 'D138 — background loads respect in-flight edits (D125 parity, v1.64)'
status: verified
connections:
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D137-LOAD-PK-GUARD
  - COMPONENT-STORE
  - DOC-SPEC-DATA
  - FILE-STORE
  - FILE-ADAPTER
verified_at: '2026-08-16T04:32:28.157Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

# D138 — background loads respect in-flight edits (D125 parity, v1.64)

`loadMany`/`loadOne` merge through the same per-field revision gate `save()`
responses use (D125): before the fetch dispatches, the loader snapshots each
EXISTING record's `recordMutationRevision`; at merge time `_upsert` passes
that snapshot as `safeMerge`'s `throughRevision`, so a field the user edited
WHILE the request was in flight keeps its local value while every other
field takes the server's. A background poll can no longer wipe the keystroke
typed during its own round trip.

## Context

The read-path merge was fully server-authoritative: `_upsert` called
`safeMerge(existing, data)` with no revision, so the D125 shield — carefully
built so a save response cannot overwrite a newer local edit — was bypassed
by any concurrent `loadMany`. Found as I11 of the 2026-07-27 pass-2 review;
semantics decided by the framework's owner: loads respect dirty edits "like
save responses do".

## Decision

Exact D125 parity — the protected window is the request's OWN flight, per
field, not open-ended dirtiness:

- `loadMany(type)` snapshots `recordKey → recordMutationRevision(record)` for
  the type's existing records immediately before its GET; `loadOne` snapshots
  the one record (when it exists). The snapshot rides to `_upsert`, which
  forwards it as `safeMerge`'s `throughRevision`.
- A field edited BEFORE the fetch dispatched still takes the server value —
  the server is authoritative over everything except edits it could not have
  seen. Open-ended "unsaved edits always win" was REJECTED: it needs a new
  synced-through dirtiness concept, lets abandoned edits shadow the server
  forever, and is not what "like save responses do" means.
- Records the server returns that did not exist at dispatch (including a
  concurrent local create colliding on pk) merge server-wins, exactly as
  today — no snapshot, no revision. Documented edge, same posture as D125's
  unconditional pk adoption.
- Public `upsert()` and `request()` response merges are UNCHANGED: those are
  explicit imperative calls whose callers intend the payload to land.
- `_synced = true` still flips on every load merge (provenance, D50).

Amends the §8 read path (D21/D137) with the §22/D125 merge gate. The
[[DECISION-D161-AUTO-FETCHING-FINDS]] implicit fault path runs these same
loaders, so tracked fault-ins inherit the gate unchanged.
