---
name: D77 — Interactive puzzle init prompts
status: built
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DECISION-D76-CLI-UPGRADE
---

# D77 — Interactive `puzzle init` prompts

On a TTY, `puzzle init` prompts for whatever was not passed: app name →
template → TypeScript. The installed CLI is the only onboarding path. Spec:
[[DOC-SPEC-BUILD]] §42.

## Decision

- Same TTY gate as every other prompt (a real isatty check, D78).
- Template prompt offers `scaffold.Templates`, `default` on empty input;
  TypeScript is y/N, default No. Both re-prompt on invalid input.
- An explicitly passed `--template`/`--typescript` is never second-guessed.
- Non-TTY: no prompts, silent flag defaults, app-name argument required — pipes
  and CI never hang.
- Prompts only choose inputs; the scaffold for a given (name, template,
  typescript) triple is the same either way.

## Alternatives

- **A separate `create-puzzle-app` wrapper package** — rejected (never
  published): a second package to version in lockstep for two questions, and it
  splits the onboarding story.
- **A full TUI wizard** — rejected for sequential one-answer questions; plain
  text loops suffice (`huh` is used only for D78's multi-select).
- **Confirm-style prompting even when flags are passed** — rejected: flags win
  everywhere else.
