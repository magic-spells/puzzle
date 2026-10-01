---
name: static subtree cache sites
status: built
path: compiler/internal/codegen/staticcache.go
language: go
summary: Detects maximal fully-static subtrees and emits them as per-owner build-once cache sites.
connections:
  - COMPONENT-CODEGEN
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
---

Source binding for the owning component card. Behavioral intent stays in [[COMPONENT-CODEGEN]] and [[DECISION-D170-INCREMENTAL-VDOM-LISTS]]; this card anchors that plan to `compiler/internal/codegen/staticcache.go`.
