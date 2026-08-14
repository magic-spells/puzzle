---
name: Puzzle CLI root
status: verified
path: compiler/cmd/puzzle/main.go
language: go
summary: Cobra root, build/dev commands, version surface, and error handling.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-07-25T00:10:00.000Z'
verified_sha: 87078756d4e8a665c4a582864fbe7273cbf6f286
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/puzzle/main.go`.
[[DECISION-D160-SPA-CODE-SPLITTING]] has the build command pass a metafile sink
into `build.Build` and hand it to `printBuildSummary`, which is what feeds the
banner's per-dependency composition breakdown and its 200 KB warning.
