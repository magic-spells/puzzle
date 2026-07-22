---
name: single-file compiler CLI
status: built
path: compiler/cmd/pzlc/main.go
language: go
summary: Internal explicit-mode pzl compiler used by tests and tooling.
connections:
  - COMPONENT-COMPILER-CLI
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/pzlc/main.go`.
