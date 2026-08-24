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
  - FEATURE-SCHEMA-VALIDATION
  - FEATURE-MODEL-RELATIONSHIPS
  - FEATURE-STORE-PUBLIC-UPSERT
  - FEATURE-VALIDATE-PK-PARITY
  - DOC-TESTING
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Store, models, validation, and relationships

The data layer with no server in the picture.

Store: records and model registration, duplicate primary keys, subscriptions and
reactivity, optional persistence, the public server-authoritative upsert, and
the server read path. Failure modes are pinned as hard as the happy path — a
corrupt storage blob cannot crash startup, model lookup ignores the `Object`
prototype chain, and the hidden-tab fallback still flushes.

Id key normalization gets its own coverage because it has to hold everywhere at
once: on lookup, across relationships, unifying duplicates that differ only by
id type, on the write path, and through a persistence round trip.

Models: field builders, computed getters, the collision case where a payload
key shadows a computed getter, the model-name guards (reserved record fields,
`Object.prototype` methods), and the payload-safety matrix where an incoming
key collides with a computed getter, a model method, or a reserved internal.
Validation is proven at every entry point —
`Model.validate()` with each rule failing and passing without throwing,
collection/short-circuit/skip semantics, `record.validate()` against current
field values, `createRecord()` enforcement, and primary-key parity between the
validate and create paths.

Relationships: schema separation, `belongsTo` and `hasMany` resolution,
store-less records, reactivity riding the normal subscription machinery, and
reserved property names.

Covers 10 files under `tests/`.
