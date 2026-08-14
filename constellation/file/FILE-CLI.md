---
name: Puzzle CLI root
status: verified
path: compiler/cmd/puzzle/main.go
language: go
summary: Cobra root, build/dev commands, version surface, and error handling.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-08-14T05:01:10.998Z'
verified_sha: d74916a0e021b6bb86394551171838fbab161347
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/puzzle/main.go`.
[[DECISION-D160-SPA-CODE-SPLITTING]] has the build command pass a metafile sink
into `build.Build` and hand it to `printBuildSummary`, which is what feeds the
banner's per-dependency composition breakdown and its 200 KB warning.
