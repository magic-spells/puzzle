---
name: artifact generator
status: verified
path: compiler/internal/generate/generate.go
language: go
summary: Component/view/layout/model generation; Component.pzl is reserved across every .pzl scaffold.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: state
    text: >-
      `withinRoot` resolves the destination with `fsutil.EvalSymlinksAllowMissing`, the one copy
      shared with internal/pieces. The `generate` command passes `--dir` to `FindProjectRoot`
      unchanged; it makes the path absolute and treats an empty one as the working directory.
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/generate/generate.go`.
