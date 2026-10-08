---
name: Component selector emission
status: built
path: compiler/internal/codegen/component.go
language: go
summary: Module bindings in Component is, helper emission and shared component prop spreads.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D180-COMPONENT-SLOT
  - FEATURE-COMPONENT-SLOT
---

Source binding for D180's reserved tag emission. [[COMPONENT-CODEGEN]] owns `is` scope, normal props/events/default slots and the per-use runtime import; no registry or module resolver is emitted.

Selector bindings that start `__` or collide with an enclosing generated row scope (`s`, `s1`, …) use fresh module-scope `__pzlComponentSelectorN` getters. Getters read live bindings rather than copying mutable `let` values; their names skip authored source occurrences. Template locals and arrow parameters still win. Ordinary module selectors remain direct lexical reads (`TestComponentSelectorHygiene`, `TestComponentSelectorGettersAvoidAuthoredArrowBindings`).
