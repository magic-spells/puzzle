---
name: "D6 — Model computed properties are plain getters"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-MODEL
  - DOC-MODELS
---

# D6 — Model computed properties are plain getters

Settled per [[DOC-SPEC]] §7. Computed properties are plain class getters — no `computedProperties` map, no registration API.

## Context
Models need computed/derived values. A framework could require a `computedProperties` map or a registration API to declare them.

## Decision
`get fullName() { return ... }` on the model class — no `computedProperties` map, no registration API.

## Alternatives rejected
- A `computedProperties` map or registration API — rejected in favor of plain getters.

## Consequences
A record **is** an instance of the registered model class, so getters and instance methods work anywhere the record is read, including templates.
