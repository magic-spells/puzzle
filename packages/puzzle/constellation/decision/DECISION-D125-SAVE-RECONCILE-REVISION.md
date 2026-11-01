---
name: >-
  D125 — A save response never overwrites a field edited while its request was in flight (per-field
  mutation revisions)
status: verified
connections:
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D21-ADAPTER-READ-PATH
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-SPEC-DATA
  - FILE-STORE
  - FILE-PUZZLE-MODEL
  - FILE-ADAPTER
verified_at: '2026-11-01T19:21:40.935Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D125 — A save response never overwrites a field edited while its request was in flight

A 2xx JSON-object save response merges into the record **per field** (D50, SPEC
§22): a field changed locally after the request was dispatched keeps its local
value; every other field, including server-computed ones, takes the server's.
Without this, one `save()` plus one keystroke during the round trip lost the
keystroke (debounced autosave, optimistic toggles), and the per-record write
chain then sent the stale value back. This is one tab protecting its own edits,
not multi-client conflict resolution.

## Decision

- **Per-field mutation revisions** live in a module-private `WeakMap` in
  `model.js` — not on the record, not in `toJSON()` or storage, released with the
  record.
- `safeAssignTracked` (the `update()` path) advances one revision per call and
  stamps every field in the patch. Construction uses untracked `safeAssign`: a
  freshly hydrated record has revision `0`, every field merges, and records never
  edited allocate nothing.
- `_saveRecordNow` captures `recordMutationRevision(record)` at the same instant
  it serializes the body.
- `safeMerge(record, src, throughRevision)` skips fields stamped after
  `throughRevision`. Storage hydration omits the argument (server-authoritative);
  `loadMany`/`loadOne` pass their own dispatch-time snapshot (D138).
- Every save-response branch reconciles through it — normal merge, mismatched-pk
  and null-pk branches, and pk adoption, which forces the server-assigned pk
  through unconditionally and reconciles the rest.
- A queued save re-serializes after the previous response settles, so it sends
  the newer local value.
- **`_synced` still flips true on a divergent reconcile.** `_synced` is
  provenance (POST vs PUT), not clean/dirty; clearing it would make the next save
  POST a duplicate. The record then holds an unpersisted local edit with no dirty
  marker, and the app decides when to `save()` again.

## Alternatives rejected

- **Compare against the dispatched body** (merge only where the local value
  still equals what was sent) — unreliable for nested or mutable object fields;
  revisions record *that* a field changed.

## Gotchas

- The D95 mock adapter's default PUT merges with ~0 latency, so mock-backed tests
  can't open the in-flight window. Test this with a deferred transport.
