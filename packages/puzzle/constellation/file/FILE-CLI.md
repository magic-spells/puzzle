---
name: Puzzle CLI root
status: verified
path: compiler/cmd/puzzle/main.go
language: go
summary: Cobra root, build/dev commands, version surface, and error handling.
connections:
  - COMPONENT-COMPILER-CLI
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

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/puzzle/main.go`.
[[DECISION-D160-SPA-CODE-SPLITTING]] has the build command pass a metafile sink
into `build.Build` and hand it to `printBuildSummary`, which is what feeds the
banner's per-dependency composition breakdown and its 200 KB warning.
