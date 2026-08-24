---
name: Puzzle add commands
status: verified
path: compiler/cmd/puzzle/add.go
language: go
summary: Tailwind, piece, and agent-skill add command wiring and user-owned-file boundaries.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-08-24T21:39:15.808Z'
code_refs:
  - compiler/cmd/puzzle/add_skills.go
  - skills/embed.go
  - skills/puzzle/SKILL.md
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/puzzle/add.go` plus the D78 skill installer (`compiler/cmd/puzzle/add_skills.go`, embedded payload in `skills/embed.go` + `skills/puzzle/SKILL.md`).
