---
name: Store, models, validation, and relationships
kind: unit
status: verified
framework: vitest
connections:
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - FILE-STORE
  - FILE-PUZZLE-MODEL
  - STATE-RECORD
  - FLOW-REACTIVITY
  - DOC-DATASTORE
  - DOC-MODELS
  - DECISION-D05-SCHEMA-BUILDERS
  - DECISION-D06-COMPUTED-GETTERS
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D63-HIDDEN-TAB-FLUSH
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
  - DECISION-D149-COMPUTED-GETTER-COLLISIONS
  - FEATURE-VALIDATE-PK-PARITY
  - DOC-TESTING
  - DECISION-D184-STORE-OBSERVE
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Store, models, validation, and relationships

The data layer with no server in the picture. Run with
`npx vitest run tests/store tests/model tests/validation tests/relationships tests/flush-dedupe tests/record-render-rev`.

- **Store** (`store`, `store-flush`, `store-hydrate-failsoft`, `flush-dedupe`): records
  and model registration, duplicate primary keys, subscriptions, optional persistence,
  the public server-authoritative `upsert()` (identity-preserving, unconditional
  overwrite, one persist per array), the server read path. Failure modes are pinned as
  hard as the happy path: a corrupt storage blob cannot crash startup, model lookup
  ignores the `Object` prototype chain, the hidden-tab fallback still flushes.
- **`store.observe()`** (`store-observe`, D184), including on an adapter app.
- **Id key normalization** (`store-id-coercion`, D112) has to hold everywhere at once:
  lookup, relationships, duplicates differing only by id type, the write path, a
  persistence round trip.
- **Render revisions** (`record-render-rev`, D170): a record prop refreshes its child on
  that record's own mutations through any store path.
- **Models** (`model`, `model-computed-getter`, `model-payload-safety`,
  `model-reserved-and-prototype-names`, `model-calendar-date-roundtrip`): field builders,
  computed getters, a payload key shadowing a getter, reserved record fields and
  `Object.prototype` names, the payload-safety matrix, and date-only fields round-tripping
  byte-identically under any process time zone.
- **Validation** at every entry point: `Model.validate()` per rule without throwing,
  collection/short-circuit/skip semantics, `record.validate()`, `createRecord()`
  enforcement, pk parity between validate and create ([[FEATURE-VALIDATE-PK-PARITY]]).
- **Relationships**: schema separation, `belongsTo`/`hasMany` resolution, store-less
  records, reactivity through the normal subscriptions, reserved property names.

Record positions and their transitions: [[STATE-RECORD]]. Server sync is
[[TEST-ADAPTER-SYNC]].
