---
name: "v1.17 — Model relationships (hasMany / belongsTo)"
status: verified
connections:
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D05-SCHEMA-BUILDERS
  - DECISION-D48-SCHEMA-VALIDATION
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - DOC-MODELS
  - DOC-DATASTORE
  - DOC-SPEC
verified_at: '2026-07-12T00:14:43.818Z'
notes:
  - kind: verified
    text: >-
      Verified at the merged main sha: getter install/partition semantics reviewed against SPEC §21
      at ship; blog acceptance case landed (PostDetail traversals); tests/relationships.test.js (21)
      + full suite green (480 vitest).
---

# v1.17 — Model relationships (`hasMany` / `belongsTo`)

The schema entries reserved since v1 now resolve. Driven by
[[DECISION-D49-MODEL-RELATIONSHIPS]]; contract in [[DOC-SPEC]] §21.

## Intent

Related records resolve through the schema instead of hand-written `filter`
joins in every `data()`: `post.comments`, `post.author`.

## Scope

**In (shipped):**
- `Puzzle.belongsTo(type, { key }?)` / `Puzzle.hasMany(type, { key }?)` — a
  distinct builder kind, excluded from `normalizedSchema()` so defaults,
  primary-key lookup, and §20 validation never see them; `toJSON()` untouched.
- The Store constructor installs lazy, idempotent, non-enumerable prototype
  getters resolving via the ordinary query path (`findOne`/`findMany`), so a
  traversal inside a tracked `data()` **auto-subscribes** like the manual join
  it replaces. Null/undefined FKs short-circuit (no junk subscription).
- FK by convention: `belongsTo` → `<relationshipName>Id`; `hasMany` →
  `<ownerTypeName>Id`; `{ key }` overrides.
- Reserved-name warn-once no-op setter (embedded server payloads can't throw
  under `Object.assign`).

**Out (rejected/deferred in D49):** eager materialization, inverse
bookkeeping, many-to-many, server fault-in ([[FEATURE-ADAPTER-WRITE-SYNC]]
layer), render-time subscription.

## Outcome

Shipped in v1.17. Runtime-only — model.js (RelationshipBuilder +
`relationshipDefs()`), store.js (getter install); `tests/relationships.test.js`
(21 tests). Acceptance met: the blog's PostDetail manual joins are replaced by
two schema lines + traversals with identical rendered output. Full suite green
(433 vitest).
