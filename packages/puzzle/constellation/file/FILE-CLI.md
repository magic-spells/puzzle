---
name: Puzzle CLI root
status: verified
path: compiler/cmd/puzzle/main.go
language: go
summary: Cobra root, build/dev/preview commands, version surface, and error handling.
connections:
  - COMPONENT-COMPILER-CLI
  - DECISION-D160-SPA-CODE-SPLITTING
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - compiler/cmd/puzzle/summary.go
---

# main.go (puzzle)

The Cobra root plus the `build`, `dev` and `preview` commands, the version surface,
and error handling; every other command self-registers from its own file. Intent:
[[COMPONENT-COMPILER-CLI]].

`build` passes a metafile sink into `build.Build` and hands it to
`printBuildSummary` (`summary.go`), which prints the size table and the
per-dependency composition breakdown with its 200 KB single-dependency warning
([[DECISION-D160-SPA-CODE-SPLITTING]]). The composition report is a courtesy: it
never fails a build.
