---
name: PuzzleModel and field builders
status: verified
connections:
  - COMPONENT-STORE
  - DOC-MODELS
  - FILE-PUZZLE-MODEL
verified_at: '2026-08-16T04:27:36.538Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
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
generates `loadMany`, `loadOne`, `create`, `update`, and `delete`; any author
function overrides its verb, and endpoint is optional when the invoked verbs
are supplied directly. A `loadAll` key throws at Store init naming `loadMany`
(D158). Those functions own only transport. Store-owned
validation, mutation-revision guards, pk adoption, `_synced` provenance, write
chaining, persistence, and notification remain identical across generated and
author transports — the D161 tracked fault path runs the same verbs.

Relationships are excluded from defaults, validation, and JSON. The Store
installs lazy prototype getters using conventional or overridden foreign keys;
reads go through local-only lookups that record the same subscription keys as
the public finds but never fault-in (D49/D161), so traversals participate in
tracking without ever issuing a request.

Assignment uses pollution-safe copy helpers. Fresh data rejects
`__proto__`/`constructor`/`prototype`; server/storage merges also reject
`_store`, `_type`, `_synced`, and `_deleted`. Framework internals, sync
provenance, and the removed-instance flag are non-enumerable. Primary keys are
immutable after indexing.
