---
name: Type-check mirror for Component selectors
status: built
path: compiler/internal/check/component.go
language: go
summary: Script binding aliases for selector expressions in the TypeScript check mirror.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D165-PUZZLE-CHECK
  - DECISION-D180-COMPONENT-SLOT
  - FEATURE-COMPONENT-SLOT
---

Source binding for D180 selector scope in the check emitter. It must agree with codegen's module-binding visibility without exposing those bindings to ordinary prop or child expressions.

The private script module exposes selector getters outside the generated `__d` function, so imported `__d`/`__f` and module row-scope names cannot resolve to checker scratch locals. `TestLiveTSCComponentSelectorHygiene` covers JS/TS typing and original-position missing-property diagnostics.
