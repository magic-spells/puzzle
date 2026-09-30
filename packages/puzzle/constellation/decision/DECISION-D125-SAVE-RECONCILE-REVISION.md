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
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D125 — A save response never overwrites a field edited while its request was in flight

Amends D50's reconciliation (SPEC §22). A 2xx JSON-object save response still
merges via the exempt upsert path, but **per field**: a field changed locally
after the request was dispatched keeps its local value. Everything else —
including server-computed fields — merges as before.

Without this, one `save()` plus one keystroke during the round trip lost the
keystroke (debounced autosave, optimistic toggles), and the per-record save
chain then sent the stale value back to the server. This is a single tab
protecting its own edits, not multi-client conflict resolution (still deferred).

## Mechanism

Per-field mutation revisions live in a module-private `WeakMap` in `model.js` —
not on the record, not in `toJSON()` or storage, released with the record.

- `safeAssignTracked` (the `update()` path) advances one revision per call and
  stamps every field in the patch. Construction uses untracked `safeAssign`: a
  freshly hydrated record has no local edits, reports revision `0`, and every
  field merges (`0 <= 0`) — no allocation for records never edited.
- `_saveRecordNow` captures `recordMutationRevision(record)` at the same instant
  it serializes the body.
- `safeMerge(record, src, throughRevision)` skips fields stamped after
  `throughRevision`. Storage hydration omits the argument (server-authoritative);
  `loadMany`/`loadOne` upserts pass their own dispatch-time snapshot (D138).
- All response branches reconcile through it — normal merge, mismatched-pk and
  null-pk `rest` branches, and pk adoption, which forces the server-assigned pk
  through unconditionally and reconciles the rest.
- A queued save re-serializes after the previous response settles and so reads
  the newer local value — no ordering change needed.

## `_synced` still flips true on divergence

`_synced` is **provenance** (POST vs PUT), not clean/dirty. Clearing it would
make the follow-up save POST a duplicate. After a divergent reconcile the record
holds an unpersisted local edit with no dirty marker; the app decides when to
`save()` again (D50's explicit-verb posture). A dirty-field API is a separate
question.

## Alternatives

- **Compare against the dispatched body** (merge only where local still equals
  what was sent) — unreliable for nested/mutable object fields; revisions record
  *that* a field changed.

## Gotcha

The D95 mock's default PUT merges with ~0 latency, so mock-backed tests can't
open the window — why this survived a green suite.
