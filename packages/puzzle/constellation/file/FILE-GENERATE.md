---
name: artifact generator
status: verified
path: compiler/internal/generate/generate.go
language: go
summary: Component/view/layout/model generation; Component.pzl is reserved across every .pzl scaffold.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-21T22:33:06.881Z'
verified_sha: c4c10f303caeac8050633ea434af17e4d3a75001
notes:
  - kind: state
    text: >-
      2026-11-08 trims: `withinRoot` resolves the destination with
      `fsutil.EvalSymlinksAllowMissing`, the one copy shared with internal/pieces (the two private
      copies were identical). The `generate` command no longer defaults `--dir` to os.Getwd();
      `FindProjectRoot` already does.
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/generate/generate.go`.
