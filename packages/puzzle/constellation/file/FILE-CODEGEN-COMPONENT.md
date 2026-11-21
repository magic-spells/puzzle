---
name: Component selector emission
status: verified
path: compiler/internal/codegen/component.go
language: go
summary: Module bindings in Component is, helper emission and shared component prop spreads.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D180-COMPONENT-SLOT
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
notes:
  - kind: state
    text: >-
      2026-11-08 codegen trims: getter aliases are numbered by count (__pzlComponentSelector0, 1,
      …); the loop that skipped an alias the user's own source already spelled is deleted (unusual
      input, owner rule), along with componentSelectorSource and hasComponentSlot.
---

# component.go

Emission for the reserved `<Component is={…}>` tag
([[DECISION-D180-COMPONENT-SLOT]]). [[COMPONENT-CODEGEN]] owns `is` scope, normal
props/events/default slots and the per-use runtime import; no registry or module
resolver is ever emitted.

- **Selector hygiene.** A selector binding that starts `__` or collides with a
  generated row scope (`s`, `s1`, …) is read through a fresh module-scope
  `__pzlComponentSelectorN` getter (numbered by count) — a getter, not a copy, so a
  mutable `let` is read live. `__pzl…` is compiler-reserved; an authored module
  binding with that spelling is not defended against. Template locals and arrow
  parameters still win. Other module selectors stay direct lexical reads.
- **Row caching (D170).** Imports and `const` selector bindings cache normally;
  only reassigned module `let`/`var` selector reads mark the enclosing row site
  volatile. A `const` map mutated in place is therefore not observed by cached
  rows — swap the map instead.
- Component-loop emission writes the resolved row key after prop spreads, so a
  spread cannot override row identity.
- The binding scan recognizes an uninitialized `let`/`var` declarator ended by ASI
  (line break or EOF); `=`, a type annotation or a comma continues it across the
  line break.

Tests: `TestComponentSelectorHygiene`,
`TestComponentSelectorGettersAvoidAuthoredArrowBindings`,
`TestComponentSelectorASIDeclarators`.
