---
name: Component selector emission
status: verified
path: compiler/internal/codegen/component.go
language: go
summary: Module bindings in Component is, helper emission and shared component prop spreads.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D180-COMPONENT-SLOT
  - FILE-CHECK-COMPONENT
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# component.go

Emission for the reserved `<Component is={…}>` tag
([[DECISION-D180-COMPONENT-SLOT]]). [[COMPONENT-CODEGEN]] owns `is` scope, normal
props/events/default slots and the per-use runtime import; no registry or module
resolver is ever emitted. The `puzzle check` emitter calls
`ComponentSelectorBindings` and `ScriptValueBindings` from here
([[FILE-CHECK-COMPONENT]]), so the two hosts agree on which module names `is` may
read.

- **Selector hygiene.** A selector binding that starts `__` or collides with a
  generated row scope (`s`, `s1`, …) is read through a fresh module-scope
  `__pzlComponentSelectorN` getter — a getter, not a copy, so a mutable `let` is
  read live; the name skips any authored occurrence. Template locals and arrow
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
