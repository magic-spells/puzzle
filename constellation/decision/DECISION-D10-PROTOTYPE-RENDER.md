---
name: "D10 — Generated `render()` attached via prototype assignment"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-CODEGEN
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
---

# D10 — Generated `render()` attached via prototype assignment

Settled per [[DOC-SPEC]] §4. The compiler emits `Component.prototype.render = function () { ... }` after the user's class definition rather than injecting a method into the class body.

## Context
The compiler must attach a generated `render()` to each component. It could inject a method into the user's class body or attach it externally.

## Decision
The compiler emits `Component.prototype.render = function () { ... }` **after** the user's class definition rather than injecting a method into the class body.

## Alternatives rejected
- Injecting the `render()` method into the class body — rejected because it rewrites the user's code, breaking sourcemap honesty and debugging.

## Consequences
The user's code is never rewritten — sourcemaps stay honest, debugging stays sane.
