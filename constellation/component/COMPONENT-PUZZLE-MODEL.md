---
name: PuzzleModel and field builders
status: verified
connections:
  - COMPONENT-STORE
  - DOC-MODELS
  - FILE-PUZZLE-MODEL
verified_at: '2026-07-23T16:30:47.420Z'
verified_sha: 93ebefacfc0dcd35ea787a1f09b56aa308bea4f9
---

# PuzzleModel and `Puzzle.*`

Store records are instances of their registered `PuzzleModel` subclass, so
plain getters and instance methods work everywhere. `Puzzle.string()`,
`number()`, `boolean()`, `date()`, `array()`, and `object()` build field
descriptors; `belongsTo()` and `hasMany()` build relationship descriptors.
Field modifiers are `primary`, `required`, `default`, `min`, `max`, `oneOf`,
and custom `validate`.

The base class provides schema normalization, primary-key discovery, per-record
default application (object/array defaults deep-clone), `update`, local-only
`destroy`, adapter-backed `save`/`delete`, static and instance `validate`, and
`toJSON`. Validation reports `{ valid, errors }`; static `validate` accepts
`{ fields }` for partial checks (the same field-subset machinery `update()` uses)
and exempts a nullish primary key — `createRecord` generates it, so the pre-create
form check accepts the same input, while `''` still fails. Invalid
create/update/save operations throw `PuzzleValidationError` before data enters
the Store. Bound checks are type-aware: declared `number()`/`date()` fields fail
`min`/`max` with a type-mismatch message rather than having their string length
measured.

Once `removeRecord` flags an instance `_deleted`, `save()` rejects (no
resurrection) and `delete()` resolves idempotently; a never-added instance still
rejects both, asynchronously.

Relationships are excluded from defaults, validation, and JSON. The Store
installs lazy prototype getters using conventional or overridden foreign keys;
reads flow through normal queries and therefore participate in tracking.

Assignment uses pollution-safe copy helpers. Fresh data rejects
`__proto__`/`constructor`/`prototype`; server/storage merges also reject
`_store`, `_type`, `_synced`, and `_deleted`. Framework internals, sync
provenance, and the removed-instance flag are non-enumerable. Primary keys are
immutable after indexing.
