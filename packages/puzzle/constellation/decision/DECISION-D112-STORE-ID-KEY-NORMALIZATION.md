---
name: >-
  D112 — Record identity is number/string-insensitive: the id index keys number ids by their string
  form
status: verified
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - COMPONENT-STORE
  - FILE-STORE
  - FILE-ADAPTER
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D112 — Record identity is number/string-insensitive

The record Map (`type → Map(id → record)`) keys **number** primary keys by their
string form via one helper, `recordKey` (`model.js`), at every id-keyed access.
Subscription keys (`type + ' ' + id`) and adapter URLs string-coerce anyway, so
the Map was the only type-sensitive index. `store.findOne('post',
this.params.id)` — route params are always strings — finds a record a
numeric-id JSON payload created. Record fields are never touched: a numeric
server id stays a number.

## Decision

- `recordKey(id)`: `typeof id === 'number'` → `String(id)`; everything else
  passes through. Applied at every record-Map `get`/`set`/`has`/`delete` keyed by
  an id — `_instantiate`, `_findOneLocal` (shared by `findOne` and D161's fetch
  path), `_upsert`, `removeRecord`, `_hydrateAll`, the save/delete in-flight
  identity re-checks, and pk adoption.
- Identity comparisons use the same rule: `_saveRecordNow`'s `pkDiffers` and
  `record.update()`'s pk check compare under `recordKey`, so a server echoing
  `1` for a record keyed `'1'` is a normal merge, not adoption and not the
  "primary keys are immutable" warning. `hasMany` normalizes both sides of its
  FK filter; `belongsTo` rides `_findOneLocal`.
- **Only numbers normalize.** `null`/`undefined`/objects keep SameValueZero
  identity (the null-FK short-circuit survives; `String(null)` can't collide with
  a `'null'` id). No numeric parsing: `'01'` ≠ `1`.
- Duplicate detection follows: `createRecord('post', { id: '1' })` while `1` is
  live throws the duplicate-pk error, and `upsert` of `'1'` updates the numeric
  record in place. A server merge may flip the pk *field*'s type; the index key
  is the same.
- `tests/store-id-coercion.test.js` pins the matrix; SPEC §8 documents the rule.

## Alternatives rejected

- **Schema-driven coercion to the pk's declared type** — schemas are optional,
  read paths are schema-exempt (D21/D48), and `Number()` is lossy (`''` → 0,
  snowflake ids above 2^53). `String(number)` is total and lossless.
- **Coercing `record.id`** — mutates data to fix an index.
- **Loose `==` in `hasMany`** — leaves `findOne` broken, and `'' == 0`.
