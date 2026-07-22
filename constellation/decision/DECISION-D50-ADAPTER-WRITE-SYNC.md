---
name: "D50 — Adapter write path: explicit save()/delete() verbs, local-first, validate-before-sync (v1.18)"
status: verified
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D48-SCHEMA-VALIDATION
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - FEATURE-ADAPTER-WRITE-SYNC
  - DOC-DATASTORE
  - DOC-MODELS
  - DOC-SPEC
verified_at: '2026-07-12T00:14:59.496Z'
notes:
  - kind: verified
    text: >-
      Decision implemented as written and verified at the merged main sha (480 vitest green); no
      deviations from the recorded contract.
---

# D50 — Adapter write path: explicit `save()`/`delete()` verbs, local-first, validate-before-sync (v1.18)

Completes the [[DECISION-D21-ADAPTER-READ-PATH]] adapter story on the write side. The
same `static adapter = { endpoint }` declaration now drives `record.save()` (create +
update sync), `record.delete()` (confirmed server delete), and `store.request()` (the
custom-endpoint escape hatch). See [[DOC-SPEC]] §22.

## Context
v1 shipped reads only; every app hand-rolled save logic — the largest gap between
Puzzle and a usable CRUD framework. Open questions: optimistic vs confirmed writes,
custom adapter methods' shape, whether query fault-in rides along, and dev-server API
mocks.

## Decision
- **Local mutations keep their exact v1 semantics; sync is a separate, explicit verb.**
  `createRecord`/`update`/`destroy` stay local-and-instant (the app is optimistic by
  construction); `save()`/`delete()` ship state to the server. This answers
  optimistic-vs-confirmed without a rollback engine: **saves are local-first** (the
  data is already on screen; a failed `save()` keeps the dirty local state and rejects
  for the component to surface — retry is calling it again), **deletes are confirmed**
  (DELETE first, local remove on ack — no resurrection machinery; on failure the
  record stays visible). (Rejected: automatic write-through on every `update()` —
  implicit network in a hot local path, debounce policy questions, and D21 chose
  explicit verbs for exactly this reason; rejected: optimistic delete with restore —
  resurrection through the subscription pipeline for marginal UX.)
- **`record.save()`**: D48-validates the full record first — invalid rejects with
  `PuzzleValidationError`, **no request made**. Then POST `apiURL+endpoint` for a
  never-synced record, PUT `endpoint/:id` otherwise (a non-enumerable synced flag:
  set by `loadAll`/`loadOne`/upserts and successful saves; hydrated-from-storage
  records count as synced — they predate the session; PUT-to-missing surfaces as an
  error the app can handle). A 2xx JSON-object response merges via the exempt upsert
  path (server-computed fields); empty/204 keeps local state. **Server pk adoption:**
  on a first save whose response carries a different primary key, the store re-keys
  its index atomically (the one sanctioned pk change, performed by the store itself);
  on an update-save a differing response pk warns and is ignored.
- **`record.delete()`**: DELETE `endpoint/:id`; 2xx **or 404** (already gone —
  idempotent) removes locally via the normal notify path; other failures reject and
  keep the record. `record.destroy()` is untouched — local-only, exactly as shipped.
- **`store.request(type, path, { method, body, headers })`** is the custom-endpoint
  surface: prefixes `apiURL + adapter.endpoint`, JSON-encodes/decodes, normalizes
  errors. The documented idiom wraps it in model instance methods
  (`publish() { return this._store.request('post', \`/\${this.id}/publish\`, { method: 'POST' }) }`).
  (Rejected: a declarative `adapter.methods` map — codegen-ish surface for something a
  three-line instance method states more clearly.)
- **Failures reject with `PuzzleAdapterError`** (`.status`, `.statusText`, `.body`
  when parseable) — exported from the package root. The D21 read path keeps its plain
  Errors (message-stable); new verbs get the structured shape.
- **Query fault-in: explicitly re-deferred.** `findMany`'s synchronous, pure-local
  return is load-bearing for the tracking/subscription machinery and the render
  contract; transparent faulting changes its type and timing. Stays out until it can
  be its own decision.
- **`puzzle dev` /api mocks: still an open question** — unchanged, tracked in
  [[DOC-SPEC]] open questions; nothing in this amendment needs it.

## Alternatives rejected
Covered inline above (write-through, optimistic delete, adapter.methods map,
fault-in). Also rejected: `record.destroy()` growing a `{ server: true }` option —
mutating shipped semantics behind a flag; a distinct verb is honest.

## Consequences
Runtime-only (model.js + store.js + index.js). Acceptance: a todos app persists
create/toggle/delete to a REST endpoint with **no hand-written fetch** —
`store.loadAll` at boot, `todo.save()` after create/toggle, `todo.delete()` on remove.
Validation composes (D48): nothing invalid leaves the client. The synced flag is
provenance-only — no dirty-tracking/changeset layer (would be its own decision).
