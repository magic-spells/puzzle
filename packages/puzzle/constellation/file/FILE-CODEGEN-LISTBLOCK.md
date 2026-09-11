---
name: list block lowering
status: built
path: compiler/internal/codegen/listblock.go
language: go
summary: 'Item-form {#for} lowering: the __list call, the __L site meta, row scopes, the __roots stamp.'
connections:
  - COMPONENT-CODEGEN
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
---

Source binding for the owning component card. Behavioral intent stays in [[COMPONENT-CODEGEN]] and [[DECISION-D170-INCREMENTAL-VDOM-LISTS]]; this card anchors that plan to `compiler/internal/codegen/listblock.go`.
