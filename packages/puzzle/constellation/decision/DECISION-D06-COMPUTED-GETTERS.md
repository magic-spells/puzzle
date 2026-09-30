---
name: "D6 — Model computed properties are plain getters"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-MODEL
  - DOC-MODELS
  - DOC-SPEC-DATA
---

# D6 — Model computed properties are plain getters

Enforced by [[DOC-SPEC-DATA]] §7.

## Decision
A computed property is a plain class getter on the model (`get fullName() { … }`) — no `computedProperties` map, no registration API. A record **is** an instance of its registered model class, so getters and instance methods work anywhere the record is read, templates included. Getter/field name collisions are [[DECISION-D149-COMPUTED-GETTER-COLLISIONS]].

## Alternatives rejected
- A `computedProperties` map or registration API — more surface for what the class already expresses.
