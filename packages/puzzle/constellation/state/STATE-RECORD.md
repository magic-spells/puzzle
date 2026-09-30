---
name: Store record lifecycle
status: verified
states:
  - name: detached
    initial: true
  - name: local
    initial: true
  - name: synced
  - name: removed
    terminal: true
transitions:
  - from: detached
    to: detached
    guard: never handed to a Store
    action: update() and validate() work locally; save() and delete() reject asynchronously
  - from: local
    to: local
    guard: patched fields pass their rules
    action: update() mutates, stamps a mutation revision, notifies, flags persistence
  - from: local
    to: local
    guard: save() rejects — validation failure before any request, or a non-OK write
    action: record stays dirty and never-synced; retry by calling again
  - from: local
    to: synced
    guard: create transport resolves 2xx
    action: >-
      merge the echoed body, adopt a differing server pk by re-keying the index atomically, set
      _synced
  - from: local
    to: synced
    guard: a load or upsert lands data at this record's key
    action: merge in place and set _synced — identity is preserved, never replaced
  - from: local
    to: removed
    guard: destroy(), or delete() on a never-synced record
    action: removeRecord — no request is sent; the delete transport is still resolved first
  - from: synced
    to: synced
    guard: patched fields pass their rules
    action: update() mutates locally; provenance is unchanged
  - from: synced
    to: synced
    guard: update transport resolves 2xx
    action: >-
      revision-gated merge — fields edited after dispatch keep their local values; a differing
      response pk warns and is dropped
  - from: synced
    to: synced
    guard: delete rejects
    action: the record stays indexed and synced
  - from: synced
    to: local
    guard: dev HMR restore in replace mode whose snapshot marker is false
    action: the snapshot's provenance is written onto the live record
  - from: synced
    to: removed
    guard: destroy() — local only, the server row survives
    action: removeRecord
  - from: synced
    to: removed
    guard: the delete transport acknowledges (the generated one treats 404 as already gone)
    action: >-
      removeRecord, but only if this is still the indexed record at the key captured before the
      await
connections:
  - FLOW-ADAPTER-SYNC
  - FLOW-REACTIVITY
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - FILE-STORE
  - FILE-PUZZLE-MODEL
  - DOC-SPEC-DATA
  - DOC-DATASTORE
  - DOC-MODELS
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - DECISION-D132-CROSS-VERB-WRITE-CHAIN
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D57-HMR-STATE-RELOAD
  - FEATURE-VALIDATE-PK-PARITY
  - FILE-ADAPTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Store record lifecycle

A record's position is held by three non-enumerable flags — `_store`, `_synced`,
`_deleted` — which are provenance, never data: `toJSON()` can't see them, merge helpers
refuse to copy them from payloads, and persistence carries provenance out of band as a
`__synced` marker. No payload can forge a position. The verbs that move records are
[[FLOW-ADAPTER-SYNC]].

```mermaid
stateDiagram-v2
  [*] --> detached: new Model(data)
  [*] --> local: createRecord
  [*] --> local: hydrate, marker false
  [*] --> synced: hydrate marker true / markerless blob

  detached --> detached: update / validate, local only
  local --> local: update
  local --> local: save rejects, stays dirty
  local --> synced: create verb 2xx
  local --> synced: load or upsert at this key
  local --> removed: destroy, or delete with no request
  synced --> synced: update
  synced --> synced: update verb 2xx, revision-gated merge
  synced --> synced: delete rejects
  synced --> local: dev HMR replace-mode restore
  synced --> removed: destroy, server row survives
  synced --> removed: delete acknowledged
  removed --> [*]
```

## Positions

- **detached** — `new Model(data)`, never handed to a Store: `update()`/`validate()` work,
  nothing indexes or notifies, no public path adopts it; `save()`/`delete()` reject
  asynchronously.
- **local** — indexed, never round-tripped. `save()` dispatches `create`; `delete()` removes
  locally and sends nothing (after resolving the delete verb, so a partial adapter reports
  the missing verb).
- **synced** — has server provenance (load, `upsert`, hydration, own save). `save()`
  dispatches `update`; `delete()` sends the verb and removes on the ack.
- **removed** — terminal, reached only through `removeRecord`, shared by `destroy()` and a
  confirmed delete so a stale reference never has to tell them apart. A removal also records
  the identity absent for D161.

**Entering**: `createRecord` is indivisible (defaults, pk, validation, insert, notify) — a
failed create leaves no trace. A missing pk auto-generates except under an explicit
`.primary().required()`. Hydration enters at the persisted marker's position (markerless →
`synced`); hydration and server upserts skip validation by design.

## Invariants

- **`_synced` is provenance, not clean/dirty**: "does the server have this row?" It stays
  true after a partly merged save response — clearing it would make the next write POST a
  duplicate.
- **`_deleted` is read before `_store`**: `removeRecord` nulls `_store`, so flag order is
  what distinguishes deleted (resolve idempotently) from never-added (reject).
- **`removeRecord` is the only writer of `_deleted`**, so a queued write tests one flag at
  the front of the chain, with no false positive on a first save.
- **Primary keys are immutable once indexed**, except a first save whose response carries a
  different key: the Store re-keys atomically, assigning the field directly (`update()`
  would throw on a pk change).
- **The index key is not the field**: numeric ids are keyed by string form
  ([[DECISION-D112-STORE-ID-KEY-NORMALIZATION]]); the field keeps the server's type.
- **In-flight is not a position**: writes serialize on one per-record chain and each link
  reads the record when it reaches the front — the position may have moved while it waited.

## Gotchas

- A removed record still accepts `update()`: it validates and lands on an object nothing
  subscribes to, silently.
- `destroy()` on a synced record leaves the server row; nothing reconciles it later.
- Records mutate in place, so identity survives every transition but removal — an upsert
  updates rather than replaces, and references stay valid across loads.
- The dev HMR replace-mode restore is the only `synced → local` path: it writes the
  snapshot's provenance onto the live record so a never-saved record still POSTs after a
  reload.
