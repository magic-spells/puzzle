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
  - DOC-SPEC-DATA
  - FILE-ADAPTER
verified_at: '2026-08-24T21:39:15.808Z'
notes:
  - kind: verified
    text: >-
      Verified at the merged main sha: save/delete/request semantics reviewed against SPEC §22 at
      ship (validate-first, POST/PUT provenance, pk adoption, confirmed deletes);
      tests/adapter-write.test.js (27) + full suite green (480 vitest).
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-1-0
change: feature
---

# v1.18 — Adapter write sync & custom adapter methods

Completes the D21 adapter story on the write side. Driven by
[[DECISION-D50-ADAPTER-WRITE-SYNC]]; contract in [[DOC-SPEC-DATA]] §22.

## Intent

A locally-changed record syncs to the server without app-level fetch plumbing,
driven by the same bare `static adapter = { endpoint }` the read path uses.

## Scope

**In (shipped):**
- **Explicit verbs, local-first:** `createRecord`/`update`/`destroy` keep exact
  v1 semantics; `record.save()` ships state (D48-validates first — invalid
  rejects with `PuzzleValidationError`, no request; POST when never-synced, PUT
  thereafter via a non-enumerable `_synced` provenance flag; 2xx JSON-object
  responses merge via the exempt path; failed saves keep dirty state and
  reject), `record.delete()` is a confirmed delete (dispatch the delete
  transport first, remove locally once it resolves; otherwise reject and the
  record stays — 404-as-success belongs to the endpoint-generated transport,
  not to the framework). Since
  [[DECISION-D132-CROSS-VERB-WRITE-CHAIN]] both verbs share the per-record
  write chain — a delete queued behind a first save targets the adopted server
  pk — and a never-synced record's `delete()` removes locally with no request.
- **Server pk adoption:** a first save whose response carries a different pk
  re-keys the store index atomically (the one sanctioned pk change); an
  update-save pk mismatch warns and is dropped from the merge.
- **`store.request(type, path, { method, body, headers })`** — the
  custom-endpoint escape hatch; documented idiom wraps it in model instance
  methods.
- **`PuzzleAdapterError`** (`.status`/`.statusText`/`.body`) from the opt-in
  `/adapter` subpath; reads normalize through it too — the D161 auto-fetch
  path recognises absence by `status === 404`, which a plain Error could not
  carry.

**Out (rejected/re-deferred in D50):** automatic write-through, optimistic
delete with restore, a declarative `adapter.methods` map, offline queueing,
conflict resolution. Query fault-in was re-deferred here and has since shipped
via [[DECISION-D161-AUTO-FETCHING-FINDS]], built on the tracked read path so
`findMany`'s load-bearing sync pure-local return stayed intact.

## Outcome



Shipped in v1.18 and extracted to `@magic-spells/puzzle/adapter` by D157. Core
keeps `_synced` provenance and local mutation; the subpath installs the server
verbs and exports the adapter error. Under
[[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]] the endpoint shorthand generates the
transports these verbs dispatch, while every reconciliation rule above stays
framework-owned and identical for author-supplied transports. Acceptance met in
tests: a todos-shaped app persists create/toggle/delete with zero hand-written
fetch.
