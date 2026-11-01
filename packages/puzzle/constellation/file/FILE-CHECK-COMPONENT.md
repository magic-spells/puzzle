---
name: Type-check mirror for Component selectors
status: verified
path: compiler/internal/check/component.go
language: go
summary: Script binding aliases for selector expressions in the TypeScript check mirror.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D165-PUZZLE-CHECK
  - DECISION-D180-COMPONENT-SLOT
  - FILE-CODEGEN-COMPONENT
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# component.go (check)

The `puzzle check` side of D180 selector scope ([[DECISION-D180-COMPONENT-SLOT]],
[[DECISION-D165-PUZZLE-CHECK]]). It must agree with codegen's module-binding
visibility — the emitter takes the names from `codegen.ComponentSelectorBindings`
and `codegen.ScriptValueBindings` — without exposing those bindings to ordinary
prop or child expressions.

The JS mirror keeps the authored script bytes and exports only the module values
selectors need, under fresh `__puzzle_component_selector_N` aliases outside the
generated `__d` function, so an imported `__d`/`__f` or a row-scope name cannot
resolve to a checker scratch local. `TestLiveTSCComponentSelectorHygiene` covers
JS/TS typing and original-position diagnostics.
