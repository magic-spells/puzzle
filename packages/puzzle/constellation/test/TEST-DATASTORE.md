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
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Store, models, validation, and relationships

The data layer with no server in the picture. Suites under `tests/`: `store*`,
`model*`, `validation`, `relationships`, `flush-dedupe`,
`record-render-rev`, `tracking-overlap`. Run with `npx vitest run tests/store tests/model tests/validation tests/relationships`.

- **Store:** records and model registration, duplicate primary keys,
  subscriptions and reactivity, optional persistence, the public
  server-authoritative `upsert()` (identity-preserving, an unconditional
  overwrite, one persist per array), and the server read path. Failure modes are
  pinned as hard as the happy path — a corrupt storage blob cannot crash
  startup, model lookup ignores the `Object` prototype chain, and the hidden-tab
  fallback still flushes.
- **Id key normalization** ([[DECISION-D112-STORE-ID-KEY-NORMALIZATION]]) has to
  hold everywhere at once: lookup, relationships, duplicates differing only by id
  type, the write path, and a persistence round trip.
- **Models:** field builders, computed getters, a payload key shadowing a
  computed getter, the model-name guards (reserved record fields,
  `Object.prototype` methods), and the payload-safety matrix (an incoming key
  colliding with a getter, a method, or a reserved internal).
- **Validation** at every entry point: `Model.validate()` per rule without
  throwing, collection/short-circuit/skip semantics, `record.validate()`,
  `createRecord()` enforcement, and pk parity between validate and create
  ([[FEATURE-VALIDATE-PK-PARITY]]).
- **Relationships:** schema separation, `belongsTo`/`hasMany` resolution,
  store-less records, reactivity through the normal subscription machinery, and
  reserved property names.
