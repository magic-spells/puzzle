---
name: pzl section splitter
status: verified
path: ../puzzle-lang/parser/sections.go
language: go
summary: Top-level section discovery with close-aware scanning and positioned offsets.
connections:
  - COMPONENT-TEMPLATE-PARSER
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

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `packages/puzzle-lang/parser/sections.go` (the Puzzle language module, D172; `path` is relative to this plan root, `packages/puzzle`).
