---
name: D138 — background loads respect in-flight edits and dispatch order
status: verified
connections:
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D137-LOAD-PK-GUARD
  - COMPONENT-STORE
  - DOC-SPEC-DATA
  - FILE-STORE
  - FILE-ADAPTER
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D138 — background loads respect in-flight edits and dispatch order

Load merges (`loadMany`, `loadOne`, and the D161 automatic fault that runs the
same loaders) get the same in-flight-edit shield as save responses (D125), plus
ordering: two reads of one identity can land out of order. A background poll
never wipes a keystroke typed during its round trip, and a slow response never
rolls back a newer one.

## Decision

**Revision gate.** Before its GET, `loadMany(type)` snapshots
`recordKey → recordMutationRevision(record)` for the type's existing records;
`loadOne` snapshots its one record if present. `_upsert` (in `adapter.js`)
passes the snapshot to `safeMerge` as `throughRevision`: a field edited while the
request was in flight keeps its local value; every other field takes the
server's.
- A field edited before dispatch takes the server value — the protected window
  is the request's own flight, not open-ended dirtiness.
- Records that did not exist at dispatch (including a local create colliding on
  pk) merge server-wins.
- Public `upsert()` and `request()` merges are ungated: explicit calls whose
  payload is meant to land.
- `_synced = true` flips on every load merge (D50).

**Dispatch order.** Every `_loadOne`/`_loadMany` takes a monotonic generation
from the store's read state (`seq`) and hands it to `_upsert`. The module
`WeakMap` `LOAD_GENERATIONS` records the highest generation landed per record; a
lower one is dropped for that record — no merge, no `_notify`, `_synced`
untouched. `clearAbsent` and the collection-complete mark still run, since a
stale response still proves the identity or collection exists.
- `_saveRecordNow` takes a generation from the same counter and stamps the
  record on success (never lowering it), so a read dispatched before the save
  cannot roll back the acknowledged body. It does not route through `_upsert`.
- Public `upsert()` passes no generation; its precedence against reads is
  undefined.
- Removals share the counter: D161 stamps the absence from `delete()`/`destroy()`
  ahead of every read already dispatched, so a stale response for that identity
  is dropped, including its `clearAbsent`. The absence-cache rules live on
  [[DECISION-D161-AUTO-FETCHING-FINDS]]; this card owns the counter.

## Alternatives rejected

- **Unsaved edits always win** — needs a synced-through dirtiness concept and
  lets abandoned edits shadow the server forever.
- **Last response wins** — a slow request rolls back a newer one.
