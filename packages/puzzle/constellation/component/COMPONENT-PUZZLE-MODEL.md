---
name: PuzzleModel and field builders
status: verified
connections:
  - COMPONENT-STORE
  - DOC-MODELS
  - FILE-PUZZLE-MODEL
verified_at: '2026-08-24T18:51:40.562Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# PuzzleModel and `Puzzle.*`

`client-runtime/model.js`. Store records are instances of their registered `PuzzleModel`
subclass, so getters and methods work everywhere. Author surface (`Puzzle.string()` …
`object()`, `belongsTo()`/`hasMany()`, modifiers `primary`, `required`, `default`, `min`,
`max`, `oneOf`, `validate`) is [[DOC-SPEC-DATA]] §7/§20/§21 and [[DOC-MODELS]].

## Base class behavior

- Schema normalization, primary-key discovery, per-record defaults (object/array defaults
  deep-clone), `update`, local-only `destroy`, static and instance `validate`, `toJSON`.
  Adapter-backed `save`/`delete` are installed by the `/adapter` capability.
- Validation returns `{ valid, errors }`; static `validate` accepts `{ fields }` for
  partial checks. It exempts a nullish primary key (`createRecord` generates it) — but
  only the `required` that `.primary()` implies: `.required()` sets a separate
  `explicitRequired` flag, so a user-supplied mandatory key reports the error, matching
  the Store. Invalid create/update/save throw `PuzzleValidationError` before data enters
  the Store. `min`/`max` on `number()`/`date()` fields fail with a type-mismatch message
  rather than measuring string length.
- After `removeRecord` flags `_deleted`, `save()` rejects and `delete()` resolves
  idempotently; a never-added instance rejects both, asynchronously.
- The static adapter is per-verb fetch functions; endpoint shorthand generates
  `loadMany`, `loadOne`, `create`, `update`, `delete`; author functions override a verb; a
  `loadAll` key throws at Store init (D158). Functions own only transport — validation,
  revision guards, pk adoption, `_synced`, write chaining, persistence and notification
  are Store-owned and identical across transports.
- Relationships are excluded from defaults, validation and JSON; the Store installs lazy
  getters that read through local-only lookups (tracked, never fetching; D49/D161).

## Payload safety

- Pollution-safe copies: fresh data rejects `__proto__`/`constructor`/`prototype`;
  server/storage merges also reject `_store`, `_type`, `_synced`, `_deleted`. Internals
  are non-enumerable; primary keys are immutable after indexing.
- **A payload key never shadows a method**: a key resolving to a function anywhere on the
  prototype chain up to `Object.prototype` (`update`, an author method, `toString`) is
  dropped on every write path. At registration `assertSchemaNames` throws for a schema
  entry that is a reserved record field or a prototype method, before relationships are
  installed.
- **`update()` drops reserved keys instead of throwing mid-patch**; D125 revision stamps
  land only on applied keys. Collision warnings are dev-only.

## Dates and render revisions

- **Declared `date()` fields** revive through `client-runtime/dates.js` (D114) at every
  JSON boundary (upsert, loads, save responses, storage restore, D161 faults via
  `_upsert`): a bare `YYYY-MM-DD` becomes a `CalendarDate`, a `Date` subclass whose
  `toJSON` re-emits the local calendar date. The subclass (not a flag) survives spreads and
  keeps `instanceof Date`; without it a date-only field serialized as a UTC instant and
  users east of UTC saved the previous day.
- **Render revision** (D170): a non-enumerable `RENDER_REV` Symbol slot the Store writes
  in `_notify`. The Symbol lives in `renderRev.js`, NOT model.js, because PuzzleView must
  never import model.js (D147's duck-typed record test). It is invisible to `toJSON`,
  `Object.keys`, merges and schema assertions, and not public API. A DIRECT field
  assignment (`todo.title = 'x'`) advances no revision and notifies nobody; a loop site
  reading a relation or computed getter is marked conservative by the compiler.
