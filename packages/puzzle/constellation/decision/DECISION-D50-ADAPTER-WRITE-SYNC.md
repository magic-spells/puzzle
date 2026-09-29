---
name: 'D50 — Adapter write path: explicit `save()`/`delete()` verbs, local-first, validate before sync'
status: verified
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D161-AUTO-FETCHING-FINDS
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-DATASTORE
  - DOC-MODELS
  - DOC-SPEC
  - DOC-SPEC-DATA
  - FILE-ADAPTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D50 — Adapter write path: explicit `save()`/`delete()` verbs, local-first

The model's `static adapter = { endpoint }` drives `record.save()`, `record.delete()` and `store.request()`, installed by the opt-in `/adapter` module ([[DECISION-D157-ADAPTER-SUBPATH]]). Reads are [[DECISION-D21-ADAPTER-READ-PATH]]. See [[DOC-SPEC-DATA]] §22.

## Decision
- **Writes are verbs, reads are queries.** `createRecord`/`update`/`destroy` stay local and instant; `save()`/`delete()` ship state to the server. No implicit network in the hot local path.
- **`record.save()` is local-first.** It validates the whole record first ([[DECISION-D48-SCHEMA-VALIDATION]]) — invalid rejects with `PuzzleValidationError` and sends nothing. Then POST `apiURL + endpoint` for a never-synced record, PUT `endpoint/:id` otherwise. "Synced" is a non-enumerable flag set by loads, upserts and successful saves, carried through persistence so a hydrated record keeps its provenance. A 2xx JSON-object response merges via the exempt upsert path; an empty/204 response keeps local state. A failed save keeps the dirty local state and rejects; retry is calling it again.
- **Server pk adoption:** on a first save whose response carries a different primary key, the store re-keys its index atomically (the one sanctioned pk change). On an update-save a differing pk warns and is ignored.
- **`record.delete()` is confirmed.** DELETE `endpoint/:id`; 2xx **or 404** (already gone) removes locally through the normal notify path; other failures reject and keep the record. A never-synced record is removed locally with no request. `record.destroy()` stays local-only.
- **`store.request(type, path, { method, body, headers })`** is the custom-endpoint surface: prefixes `apiURL + adapter.endpoint`, JSON-encodes and decodes, normalizes errors. Idiom: wrap it in a model instance method (`publish() { return this._store.request('post', \`/${this.id}/publish\`, { method: 'POST' }) }`).
- **Failures reject with `PuzzleAdapterError`** (`.status`, `.statusText`, `.body` when parseable), exported from `@magic-spells/puzzle/adapter`. Reads normalize through the same shape ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]); the D161 negative cache keys off `status`.
- The synced flag is provenance only — no dirty tracking or changesets.

## Alternatives rejected
- Automatic write-through on every `update()` — implicit network, debounce policy questions.
- Optimistic delete with restore — resurrection through the subscription pipeline for marginal UX.
- A declarative `adapter.methods` map — a three-line instance method states it more clearly.
- `record.destroy({ server: true })` — a flag that changes shipped semantics; a distinct verb is honest.
