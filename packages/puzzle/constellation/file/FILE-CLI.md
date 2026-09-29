---
name: Puzzle CLI root
status: verified
path: compiler/cmd/puzzle/main.go
language: go
summary: Cobra root, build/dev commands, version surface, and error handling.
connections:
  - COMPONENT-COMPILER-CLI
  - DECISION-D160-SPA-CODE-SPLITTING
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# main.go (puzzle)

The Cobra root: build/dev commands, the version surface, and error handling;
other commands self-register from their own files. Intent:
[[COMPONENT-COMPILER-CLI]].

The build command passes a metafile sink into `build.Build` and hands it to
`printBuildSummary`, which feeds the banner's per-dependency composition
breakdown and its 200 KB single-dependency warning
([[DECISION-D160-SPA-CODE-SPLITTING]]).
