---
name: "D5 — Schema declared via `Puzzle.*` field builders"
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-PUZZLE-MODEL
  - DOC-MODELS
  - DOC-SPEC
  - DOC-SPEC-DATA
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D5 — Schema declared via `Puzzle.*` field builders

Enforced by [[DOC-SPEC-DATA]] §7. One obvious style with far less boilerplate than descriptor objects.

## Decision
- Model schemas use fluent builders — `Puzzle.string().required().min(1, 'msg')` — and they are the only documented authoring surface.
- Raw descriptor objects remain the internal normalized format.
- Relationships use the same namespace (`Puzzle.hasMany`, `Puzzle.belongsTo`, [[DECISION-D49-MODEL-RELATIONSHIPS]]); validation rules enforce per [[DECISION-D48-SCHEMA-VALIDATION]].

## Alternatives rejected
- Raw descriptors (`{ type: 'string', required: true, validate: [...] }`) as the authoring surface — boilerplate with no single style.
