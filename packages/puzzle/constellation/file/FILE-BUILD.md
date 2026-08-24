---
name: compiler build orchestrator
status: verified
path: compiler/internal/build/build.go
language: go
summary: Staged browser builds, assets, styles, validation, and atomic dist swap.
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-BUILD
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/build/build.go`.
[[DECISION-D160-SPA-CODE-SPLITTING]] resolves `cfg.Splitting() && mode !=
"static"` before `ValidatePublic` — static mode deletes this pass's `app.js`
before the swap, so splitting it would strand chunks nothing imports — and
`ValidatePublic` takes that boolean, reserving the root-level `chunks/` entry
only while splitting is on. An app that never opts in keeps its `public/chunks/`
assets, which is why the name is not in `reservedOutputNames`.
