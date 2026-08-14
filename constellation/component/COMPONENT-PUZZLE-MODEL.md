---
name: PuzzleModel and field builders
status: verified
connections:
  - COMPONENT-STORE
  - DOC-MODELS
  - FILE-PUZZLE-MODEL
verified_at: '2026-07-25T00:10:00.000Z'
verified_sha: 87078756d4e8a665c4a582864fbe7273cbf6f286
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
`destroy`, static and instance `validate`, and `toJSON`. Adapter-backed
`save`/`delete` are absent from core and installed on the prototype by the
app-level capability from `@magic-spells/puzzle/adapter`. Validation reports `{ valid, errors }`; static `validate` accepts
`{ fields }` for partial checks (the same field-subset machinery `update()` uses)
and exempts a nullish primary key — `createRecord` generates it, so the pre-create
form check accepts the same input, while `''` still fails. That exemption covers
only the `required` that `.primary()` *implies*: `.required()` sets a separate
`explicitRequired` flag, so `slug: string().primary().required()` — an author
declaring a user-supplied key mandatory — reports the required error instead, and
a create form's pre-check blocks submission rather than letting the Store
silently auto-generate a random key (FEATURE-VALIDATE-PK-PARITY). Invalid
create/update/save operations throw `PuzzleValidationError` before data enters
the Store. Bound checks are type-aware: declared `number()`/`date()` fields fail
`min`/`max` with a type-mismatch message rather than having their string length
measured.

Once `removeRecord` flags an instance `_deleted`, `save()` rejects (no
resurrection) and `delete()` resolves idempotently; a never-added instance still
rejects both, asynchronously.

The model's static adapter is a set of fetch functions. Endpoint shorthand
generates `loadAll`, `loadOne`, `create`, `update`, and `delete`; any author
function overrides its verb, and endpoint is optional when the invoked verbs
are supplied directly. Those functions own only transport. Store-owned
validation, mutation-revision guards, pk adoption, `_synced` provenance, write
chaining, persistence, and notification remain identical across generated and
author transports.

Relationships are excluded from defaults, validation, and JSON. The Store
installs lazy prototype getters using conventional or overridden foreign keys;
reads flow through normal queries and therefore participate in tracking.

Assignment uses pollution-safe copy helpers. Fresh data rejects
`__proto__`/`constructor`/`prototype`; server/storage merges also reject
`_store`, `_type`, `_synced`, and `_deleted`. Framework internals, sync
provenance, and the removed-instance flag are non-enumerable. Primary keys are
immutable after indexing.
