---
name: D77 — Interactive puzzle init prompts
status: verified
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DECISION-D76-CLI-UPGRADE
code_refs:
  - compiler/cmd/puzzle/initcmd.go
verified_at: '2026-11-23T20:45:09.431Z'
verified_sha: 15992ae87ef804f8a7f5572264cd0a099b40385f
---

# D77 — Interactive `puzzle init` prompts

On a TTY, `puzzle init` prompts for whatever was not passed: app name → template → TypeScript. The installed CLI is the only onboarding path. Spec: [[DOC-SPEC-BUILD]] §42.

## Decision

- Interactive means a real terminal on stdin (`ui.IsTerminal`, a true isatty check) and no `--yes`/`-y`.
- Template prompt lists `scaffold.Templates`, one line each, then reads a name; `default` on empty input. TypeScript is y/N, default No. Both re-prompt on invalid input. Plain text loops, no TUI library.
- An explicitly passed `--template`/`--typescript` is never second-guessed.
- Non-interactive (pipe, CI, `--yes`): no prompts, flag defaults, app-name argument required — scripts never hang.
- Prompts only choose inputs; the scaffold for a given (name, template, typescript) triple is the same either way.

## Alternatives rejected

- **A separate `create-puzzle-app` wrapper package** — a second package to version in lockstep for two questions, and it splits the onboarding story.
- **A full TUI wizard** — overkill for sequential one-answer questions (`huh` is used only for D78's multi-select).
- **Confirm-style prompting even when flags are passed** — flags win everywhere else.
