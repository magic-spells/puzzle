---
name: PuzzleModel and field builders
status: verified
connections:
  - COMPONENT-STORE
  - DOC-MODELS
  - FILE-PUZZLE-MODEL
verified_at: '2026-07-22T00:04:07.535Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
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
`toJSON`. Validation reports `{ valid, errors }`; invalid create/update/save
operations throw `PuzzleValidationError` before data enters the Store. Bound
checks are type-aware: declared `number()`/`date()` fields fail `min`/`max` with a
type-mismatch message rather than having their string length measured.

Relationships are excluded from defaults, validation, and JSON. The Store
installs lazy prototype getters using conventional or overridden foreign keys;
reads flow through normal queries and therefore participate in tracking.

Assignment uses pollution-safe copy helpers. Fresh data rejects
`__proto__`/`constructor`/`prototype`; server/storage merges also reject
`_store`, `_type`, and `_synced`. Framework internals and sync provenance are
non-enumerable. Primary keys are immutable after indexing.
