---
name: style pipeline
status: built
path: compiler/internal/styles/styles.go
language: go
summary: Tailwind resolution/execution and final CSS composition.
connections:
  - COMPONENT-ESBUILD-PLUGIN
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/styles/styles.go`.
