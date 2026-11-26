---
name: Puzzle add commands
status: verified
path: compiler/cmd/puzzle/add.go
language: go
summary: Tailwind, piece, theme, deploy-template and agent-skill add command wiring and user-owned-file boundaries.
connections:
  - COMPONENT-COMPILER-CLI
verified_at: '2026-11-26T05:26:02.017Z'
code_refs:
  - compiler/cmd/puzzle/add_skills.go
  - compiler/cmd/puzzle/add_deploy.go
  - deploy/embed.go
  - skills/embed.go
  - skills/puzzle/SKILL.md
verified_sha: 2f5f6d0cebefc1d6b3c8f4cde3f4b4795d3e78c3
notes:
  - kind: state
    text: >-
      `addPieces` and `addThemes` pass `--dir` to `generate.FindProjectRoot` unchanged: it makes the
      path absolute, and an empty `--dir` is the working directory. `tailwindRoot` keeps its own
      `filepath.Abs` because it falls back to the start directory when no project root is found.
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/cmd/puzzle/add.go` plus the D78 skill installer (`compiler/cmd/puzzle/add_skills.go`, embedded payload in `skills/embed.go` + `skills/puzzle/SKILL.md`). `puzzle add deploy <host>` (D198) lives in `compiler/cmd/puzzle/add_deploy.go` and copies a template from the embedded `deploy/` folder (`deploy/embed.go`).

User-owned files are never rewritten. `add tailwind` writes `puzzle.config.js` only when it is absent, and `app/styles/styles.css` holding only `@import "tailwindcss";` only when no stylesheet in `app/styles/` already imports Tailwind. `add piece`, like every `generate` kind, first checks the CLI/runtime pair (`build.PairRuntime`, [[DECISION-D202-CLI-RUNTIME-VERSION-PAIR]]) and stops across a breaking release. The copy, the lock and the printed next steps live in `internal/pieces`; the next steps include the npm install line and one `@import` line per stylesheet the resolved pieces list in `styles`, in load order. Pieces come from the release on the CLI's own major.minor; when there is none, the command stops.
