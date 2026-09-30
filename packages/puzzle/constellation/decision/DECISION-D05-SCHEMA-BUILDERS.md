---
name: "D5 — Schema declared via `Puzzle.*` field builders"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-MODEL
  - DOC-MODELS
  - DOC-SPEC
  - DOC-SPEC-DATA
---

# D5 — Schema declared via `Puzzle.*` field builders

Enforced by [[DOC-SPEC-DATA]] §7.

## Decision
Model schemas use fluent builders — `Puzzle.string().required().min(1, 'msg')` — and they are the only documented authoring surface. Raw descriptor objects remain the internal normalized format. Relationships use the same namespace (`Puzzle.hasMany`, `Puzzle.belongsTo`, [[DECISION-D49-MODEL-RELATIONSHIPS]]); validation rules enforce per [[DECISION-D48-SCHEMA-VALIDATION]].

## Why
Far less boilerplate than descriptors and one obvious style. If the `Puzzle` namespace ever needs app-level statics, a dedicated `field.*` namespace is the fallback.

## Alternatives rejected
- Raw descriptors (`{ type: 'string', required: true, validate: [...] }`) as the authoring surface — boilerplate with no single style.
