---
name: PuzzleModel and field builders
status: verified
connections:
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - DOC-MODELS
  - DOC-SPEC-DATA
  - FILE-PUZZLE-MODEL
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D114-CALENDAR-DATE-FORMATTERS
  - DECISION-D125-SAVE-RECONCILE-REVISION
verified_at: '2026-11-01T19:23:56.488Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# PuzzleModel and `Puzzle.*`

`client-runtime/model.js`. Store records are instances of their registered `PuzzleModel` subclass, so getters and methods work everywhere. The author surface (builders, modifiers, relationships) is [[DOC-SPEC-DATA]] §7/§20/§21 and [[DOC-MODELS]].

## Base class behavior

- Schema normalization, primary-key discovery (`primaryKey()`: the first `.primary()` field, else `'id'`), per-record defaults (object/array defaults `structuredClone` per record), `update`, local-only `destroy`, static and instance `validate`, `toJSON`. Adapter-backed `save`/`delete` are installed by [[COMPONENT-ADAPTER]].
- Validation returns `{ valid, errors }`; static `validate` applies defaults and accepts `{ fields }` for partial checks. It exempts a nullish primary key (`createRecord` generates it) — but only the `required` that `.primary()` implies: `.required()` sets a separate `explicitRequired` flag, so a user-supplied mandatory key reports the error, matching the Store. `min`/`max` on `number()`/`date()` fields fail with a type-mismatch message rather than measuring string length.
- `update(patch)` throws on a pk change while attached, validates only the patched keys, then applies them through the tracked assign (D125 revision stamps land only on applied keys) and calls `store.recordChanged`.
- After `removeRecord` sets `_deleted`, `save()` rejects and `delete()` resolves idempotently; a never-added instance rejects both, asynchronously.
- Relationships are excluded from defaults, validation and JSON; the Store installs their lazy getters.

## Payload safety

- Pollution-safe copies: every write path skips `__proto__`/`constructor`/`prototype`; server and storage merges (`safeMerge`) also skip `_store`, `_type`, `_synced`, `_deleted`. Internals are non-enumerable.
- **A payload key never shadows a method or getter**: a key resolving to a getter-only accessor or a function anywhere on the prototype chain up to `Object.prototype` (`update`, an author method, `toString`) is dropped on every write path. An own data property, or an accessor with a setter (relationships), stays assignable. At registration `assertSchemaNames` (dev) throws for a schema entry that is a reserved field or a prototype method, before relationships are installed.
- **`update()` drops reserved keys instead of throwing mid-patch.** Collision warnings are dev-only.

## Dates and render revisions

- **Declared `date()` fields** revive through `client-runtime/dates.js` ([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]) at every JSON boundary (`_upsert` — so loads, upserts and fetches — save responses, storage restore). A bare `YYYY-MM-DD` becomes a `CalendarDate`, a `Date` subclass whose `toJSON` re-emits the local calendar date; a subclass (not a flag) survives spreads and keeps `instanceof Date`. Without it a date-only field would serialize as a UTC instant and users east of UTC would save the previous day.
- **Render revision** (D170): a non-enumerable `RENDER_REV` Symbol slot the Store writes in `_notify`. The Symbol lives in `renderRev.js`, NOT model.js, because PuzzleView must never import model.js (D147's duck-typed record test). It is invisible to `toJSON`, `Object.keys`, merges and schema checks, and is not public API. A direct field assignment advances no revision and notifies nobody; a loop site reading a relation or computed getter is marked conservative by the compiler.
