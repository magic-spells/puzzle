---
name: 'D48 — Schema validation at the local write boundary: throw on write, `{ valid, errors }` to render'
status: verified
connections:
  - DECISION-D05-SCHEMA-BUILDERS
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-MODELS
  - DOC-DATASTORE
  - DOC-SPEC
  - DOC-SPEC-DATA
  - DECISION-D50-ADAPTER-WRITE-SYNC
verified_at: '2026-11-01T19:23:24.972Z'
code_refs:
  - client-runtime/model.js
  - client-runtime/datastore/store.js
  - client-runtime/datastore/adapter.js
  - client-runtime/fixtures/generator.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D48 — Schema validation at the local write boundary

The rules the [[DECISION-D05-SCHEMA-BUILDERS]] builders store (`required`, `min`, `max`, `oneOf`, `validate`) enforce on local writes. See [[DOC-SPEC-DATA]] §20.

## Decision

- **Throw at the write boundary.** `store.createRecord(type, data)` (after defaults and pk generation) and `record.update(patch)` throw `PuzzleValidationError` (exported from the package root) with `.errors` = `[{ field, rule, message }]` in schema order. Invalid data never enters the store: a failed create inserts, notifies and persists nothing; a failed update leaves the record untouched. Both keep their return-the-record contract.
- **`{ valid, errors }` is the renderable surface.** Static `Model.validate(data, { fields? })` (pre-create form check; defaults applied first, `fields` limits it to named fields) and `record.validate()` return it without throwing. Reactive error display lives in component state.
- **Always on for local writes; server and hydration paths exempt.** No opt-out flag — enforcement fires only where rules are declared. `loadMany`/`loadOne` upserts skip validation (the server is authoritative, and backend drift must not crash reads), and so does storage hydration.
- **Rule semantics — no type coercion:** `required` fails on `undefined`/`null`/`''` and short-circuits that field; a non-required `undefined`/`null` skips the field's other rules; `min`/`max` compare `.length` for strings/arrays and the value for numbers/dates; `oneOf` is strict `===` membership; a custom `validate(fn)` fails on a falsy return, and a thrown exception propagates (a broken validator is a bug, not a failure). All failing fields are collected. Type mismatches are not validated.
- **An explicitly `required` primary key is not auto-generated** on `createRecord`, so a missing one fails validation exactly as `Model.validate()` reports it. Server upserts still auto-generate.
- **`update()` validates only the fields in the patch**, so a record created under laxer rules is never bricked by an unrelated update.
- `record.save()` validates the whole record before any request ([[DECISION-D50-ADAPTER-WRITE-SYNC]]). Default messages name the field and bound; exact strings live in `model.js`.

## Alternatives rejected
- A persistent `record.errors` (Ember) — records are the user's class instances rendered in templates; framework state on them leaks into `toJSON()` and spreads.
- Returning a result object instead of throwing — breaks return-the-record chaining.
- Opt-in enforcement, or a per-call `{ validate: false }` — nobody asked; can layer on compatibly.
- Validating server upserts — crashes apps on backend drift.
