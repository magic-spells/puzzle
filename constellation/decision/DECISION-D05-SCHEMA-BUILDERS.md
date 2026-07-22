---
name: "D5 — Schema declared via `Puzzle.*` field builders"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-MODEL
  - DOC-MODELS
  - DOC-SPEC
---

# D5 — Schema declared via `Puzzle.*` field builders

Settled per [[DOC-SPEC]] §7. Schemas use fluent field builders (`Puzzle.string().required().min(1, 'msg')`) instead of raw descriptor objects.

## Context
Schema fields could be declared either as raw descriptor objects (`{ type: 'string', required: true, validate: [...] }`) or via a fluent builder API. Raw descriptors are boilerplate-heavy and offer no obvious single style.

## Decision
`Puzzle.string().required().min(1, 'msg')` instead of raw descriptor objects. Builders are the only documented way; raw descriptors remain an internal normalized format.

## Alternatives rejected
- Raw descriptor objects as the authoring surface (`{ type: 'string', required: true, validate: [...] }`) — kept only as the internal normalized format, not documented for authors.

## Consequences
Rationale: dramatically less boilerplate, one obvious style, and a clean future home for relationships (`Puzzle.hasMany('tag')`) inside the same schema block. Open item: if the `Puzzle` namespace ever needs app-level statics, a dedicated `t.*`/`field.*` namespace is the fallback.
