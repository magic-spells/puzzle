---
name: "v1.18 — Adapter write sync & custom adapter methods"
status: verified
connections:
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D48-SCHEMA-VALIDATION
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-DATASTORE
  - DOC-MODELS
  - DOC-SPEC
verified_at: '2026-07-12T00:14:45.180Z'
verified_sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
notes:
  - kind: verified
    text: >-
      Verified at the merged main sha: save/delete/request semantics reviewed against SPEC §22 at
      ship (validate-first, POST/PUT provenance, pk adoption, confirmed deletes);
      tests/adapter-write.test.js (27) + full suite green at this sha (480 vitest).
    sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
---

# v1.18 — Adapter write sync & custom adapter methods

Completes the D21 adapter story on the write side. Driven by
[[DECISION-D50-ADAPTER-WRITE-SYNC]]; contract in [[DOC-SPEC]] §22.

## Intent

A locally-changed record syncs to the server without app-level fetch plumbing,
driven by the same `static adapter = { endpoint }` the read path uses.

## Scope

**In (shipped):**
- **Explicit verbs, local-first:** `createRecord`/`update`/`destroy` keep exact
  v1 semantics; `record.save()` ships state (D48-validates first — invalid
  rejects with `PuzzleValidationError`, no request; POST when never-synced, PUT
  thereafter via a non-enumerable `_synced` provenance flag; 2xx JSON-object
  responses merge via the exempt path; failed saves keep dirty state and
  reject), `record.delete()` is a confirmed delete (DELETE first; 2xx or 404
  removes locally; otherwise rejects and the record stays).
- **Server pk adoption:** a first save whose response carries a different pk
  re-keys the store index atomically (the one sanctioned pk change); an
  update-save pk mismatch warns and is dropped from the merge.
- **`store.request(type, path, { method, body, headers })`** — the
  custom-endpoint escape hatch; documented idiom wraps it in model instance
  methods.
- **`PuzzleAdapterError`** (`.status`/`.statusText`/`.body`) from the package
  root; the D21 read path keeps its plain-Error messages.

**Out (rejected/re-deferred in D50):** automatic write-through, optimistic
delete with restore, a declarative `adapter.methods` map, query fault-in
(re-deferred — `findMany`'s sync pure-local return is load-bearing), offline
queueing, conflict resolution.

## Outcome

Shipped in v1.18. Runtime-only — model.js (`_synced`, `save()`, `delete()`),
store.js (`saveRecord`/`deleteRecord`/`request` + error class), index.js
export; `tests/adapter-write.test.js` (27 tests). Acceptance met in tests: a
todos-shaped app persists create/toggle/delete with zero hand-written fetch.
Suite at 460 at ship time.
