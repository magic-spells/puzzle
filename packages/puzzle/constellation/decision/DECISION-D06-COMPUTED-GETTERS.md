---
name: "D6 — Model computed properties are plain getters"
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-PUZZLE-MODEL
  - DOC-MODELS
  - DOC-SPEC-DATA
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D6 — Model computed properties are plain getters

Enforced by [[DOC-SPEC-DATA]] §7.

## Decision
A computed property is a plain class getter on the model (`get fullName() { … }`) — no `computedProperties` map, no registration API. A record **is** an instance of its registered model class, so getters and instance methods work anywhere the record is read, templates included. Getter/field name collisions are [[DECISION-D149-COMPUTED-GETTER-COLLISIONS]].

## Alternatives rejected
- A `computedProperties` map or registration API — more surface for what the class already expresses.
