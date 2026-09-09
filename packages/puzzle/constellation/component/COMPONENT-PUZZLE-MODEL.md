---
name: PuzzleModel and field builders
status: verified
connections:
  - COMPONENT-STORE
  - DOC-MODELS
  - FILE-PUZZLE-MODEL
verified_at: '2026-08-24T18:51:40.562Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
notes:
  - kind: verified
    text: >-
      Method-name payload protection, assertSchemaNames registration guard, reserved-key update()
      drop, and the CalendarDate/dates.js revival rule all truthed against model.js, store.js and
      dates.js.
    sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
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

**A payload key can never shadow a method.** A key resolving to a function on
the model prototype — `update`, `destroy`, `toJSON`, an author method, or an
`Object.prototype` name like `toString`/`valueOf` — is dropped on every write
path rather than assigned over the method. The collision walk runs the whole
prototype chain to `Object.prototype`, because a `toString` payload key silently
blanked a render before it did. The Store closes the same hole one level earlier:
at registration `assertSchemaNames` throws for a schema entry that is a reserved
record field (the merge set drops it, so the field could never hold data — a
`required` rule on it would fail forever) or that resolves to a prototype method.
It is hoisted ahead of relationship installation so a bad name is reported before
anything is built on it.

**`update()` drops reserved keys instead of throwing mid-patch**, so a caller
handing it a whole server object gets the legal subset applied rather than a
half-written record; D125 revision stamps land only on the keys that were
actually applied. Advisory collision warnings sit behind `__PUZZLE_DEV__` and
strip from production.

**Declared `date()` fields carry the day/instant distinction on the value.**
`client-runtime/dates.js` owns the shared rule (D114) and every JSON boundary
funnels through it — upsert, loads, save responses, storage restore, and D161's
auto-fetch faults (which reach `_upsert`, so they needed no new boundary). A
bare `YYYY-MM-DD` revives as a `CalendarDate`, a `Date` subclass whose `toJSON`
re-emits the calendar date read off its **local** fields. Anything else revives
as an ordinary `Date` and is byte-identical to before. The subclass rather than
a flag is what makes it survive: `instanceof Date` still holds for validation,
`Intl`, and comparison, the tag cannot be lost to a spread of the field, and
`toJSON` is the single hook every write path already goes through. Without it a
date-only field revived to local midnight and serialized via `Date#toJSON` as a
UTC instant, so every user east of UTC saved the previous day.
