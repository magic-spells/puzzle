---
name: Puzzle add commands
status: verified
path: compiler/cmd/puzzle/add.go
language: go
summary: Tailwind, piece, theme, deploy-template and agent-skill add command wiring and user-owned-file boundaries.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-01T19:19:18.479Z'
code_refs:
  - compiler/cmd/puzzle/add_skills.go
  - compiler/cmd/puzzle/add_deploy.go
  - deploy/embed.go
  - skills/embed.go
  - skills/puzzle/SKILL.md
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
notes:
  - kind: state
    text: >-
      2026-11-08 trims: `--dir` is passed through unchanged (no "." default, no `filepath.Abs` in
      `addPieces`/`addThemes`): `generate.FindProjectRoot` makes it absolute, and `Abs("")` is the
      working directory. `tailwindRoot` keeps its own Abs because it falls back to the start dir
      when no project root is found.
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/puzzle/add.go` plus the D78 skill installer (`compiler/cmd/puzzle/add_skills.go`, embedded payload in `skills/embed.go` + `skills/puzzle/SKILL.md`). `puzzle add deploy <host>` (D198) lives in `compiler/cmd/puzzle/add_deploy.go` and copies a template from the embedded `deploy/` folder (`deploy/embed.go`).
