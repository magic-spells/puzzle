---
name: Puzzle add commands
status: verified
path: compiler/cmd/puzzle/add.go
language: go
summary: Tailwind, piece, and agent-skill add command wiring and user-owned-file boundaries.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-08-23T19:55:37.455Z'
code_refs:
  - compiler/cmd/puzzle/add_skills.go
  - skills/embed.go
  - skills/puzzle/SKILL.md
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/puzzle/add.go` plus the D78 skill installer (`compiler/cmd/puzzle/add_skills.go`, embedded payload in `skills/embed.go` + `skills/puzzle/SKILL.md`).
