---
name: >-
  D112 — record identity is number/string-insensitive: the id index keys number ids by their string
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
verified_at: '2026-08-16T04:30:59.015Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
notes:
  - kind: verified
    text: >-
      Merged to main via PR #26 and re-verified at merged main: full vitest suite (69 files / 1236
      tests incl. the 13-test tests/store-id-coercion.test.js matrix) and all 14 Go packages green.
      10 of the 13 new tests fail against pre-fix HEAD, pinning the bug; the other 3 pin behavior
      the fix must not change ('01' ≠ 1, null-FK short-circuit).
    sha: 11f64be1b6828318f5085a5dc16ebe8f53ebfbd4
---

The record Map (`type → Map(id → record)`) keys **number** primary keys by
their string form, via one module-scope helper (`recordKey`) applied at every
id-keyed map access. Subscription keys (`type + ' ' + id`) and adapter URLs
(`encodeURIComponent(record[pk])`) already string-coerced identity — the Map
was the store's only type-sensitive index. `store.findOne('post',
this.params.id)`, the documented route-param pattern, now finds the record a
numeric-id JSON payload created. Record fields are never touched: a numeric
server id stays a number on the record.

## Context

The two lines of `findOne` disagreed about identity:

```js
this._subscribe(type + REC_SEP + id);        // string concat: 1 and '1' → 'post 1'
return this._typeMap(type).get(id) ?? null;  // SameValueZero: 1 and '1' differ
```

Route params are strings by construction (`decodeURIComponent`), JSON APIs
usually return numeric ids, so the documented pattern subscribed to the right
key and then missed the loaded record. The failure was maximally misdirecting:
the subscription fired on every change and `data()` re-ran, so reactivity
looked healthy while lookups returned `null` — debugging went toward data
loading, never Map key types. `hasMany`'s strict `===` FK filter had the
mirror bug: a string FK against a numeric pk silently yielded `[]`.

## Decision

- One helper, `recordKey(id)`: `typeof id === 'number'` → `String(id)`,
  everything else passes through untouched. Applied at every record-Map
  `get`/`set`/`has`/`delete` keyed by an id: `_instantiate` (dup check + skip
  branch + insert), `findOne`, `_upsert`, `removeRecord`, `_hydrateAll`, the
  save/delete in-flight identity re-checks, and pk adoption.
- **Identity comparisons use the same rule.** `_saveRecordNow`'s `pkDiffers`
  compares under `recordKey`, so a server echoing numeric `1` for a record
  keyed `'1'` is a normal merge (the field adopts the server's type; the map
  key is identical either way) — not pk adoption, and not the spurious
  "primary keys are immutable" warning.
- `hasMany` normalizes both sides of its FK filter; `belongsTo` rides
  `findOne` and needs nothing.
- **Only numbers normalize.** `null`/`undefined`/objects keep SameValueZero
  identity — preserving `belongsTo`'s null-FK short-circuit, and `String(null)`
  can never collide with a legitimate `'null'` string id. No numeric parsing
  either: `'01'` and `1` stay distinct.
- **Normalization lives at the index boundary only.** Record data is never
  coerced.

## Alternatives rejected

- **Schema-driven coercion** (cast lookup ids to the pk's declared
  `Puzzle.number()` type). Schemas are optional, so a string fallback is needed
  anyway — two identity regimes, and adding a schema later would change lookup
  semantics. The read paths are deliberately schema-exempt and
  server-authoritative ([[DECISION-D48-SCHEMA-VALIDATION]],
  [[DECISION-D21-ADAPTER-READ-PATH]]), so the Map can legitimately hold ids the
  schema disagrees with — casting at lookup recreates the miss in mirror image.
  And `Number()` is lossy: `Number('') === 0`, `Number('abc')` is `NaN`, and
  string ids above 2^53 (snowflake ids) silently lose precision, where
  `String(number)` is total and lossless. Schema-aware *attribute casting* at
  the write boundary remains a possible future feature; it is orthogonal and
  cannot replace the identity fix because the exempt paths bypass it.
- **Coercing `record.id` to match the lookup** — mutating user/server data to
  fix an index.
- **Loose `==` in `hasMany` only** — leaves `findOne` broken and introduces a
  second identity rule (`'' == 0` is true under `==`; `recordKey` keeps them
  distinct).

## Consequences

- **Duplicate detection unifies** (the observable contract change):
  `createRecord('post', { id: '1' })` while numeric `1` is live now throws the
  duplicate-pk error, and `upsert` of `'1'` updates the numeric-keyed record in
  place. Previously both silently created a shadow record — which was precisely
  the corruption this bug produced.
- A server-authoritative merge may flip the pk **field**'s type (`upsert`
  `{ id: '1' }` onto record id `1` → `record.id` becomes `'1'`); the index key
  is identical either way, so nothing desyncs. Server wins on fields, as
  everywhere.
- `tests/store-id-coercion.test.js` pins the matrix: findOne both directions,
  the sub-key/map-key agreement regression, cross-type `hasMany`/`belongsTo`
  FK resolution, duplicate unification, the numeric pk echo on save (no
  spurious warning), exactness (`'01'` ≠ `1`), and a persistence round-trip.
- SPEC §8 documents the identity rule; §21's resolution bullet notes the FK
  comparison uses it.
