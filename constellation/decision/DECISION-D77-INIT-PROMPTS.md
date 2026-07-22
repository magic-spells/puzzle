---
name: 'D77 — Interactive `puzzle init` prompts (v1.44)'
status: built
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DECISION-D76-CLI-UPGRADE
---

# D77 — Interactive `puzzle init` prompts (v1.44)

On a TTY, `puzzle init` prompts for the template and TypeScript choices when their
flags were not explicitly passed — extending the D32 app-name-prompt exception into
a small guided flow. See [[DOC-SPEC]] §42 for the contract.

## Context

§13 declared `init` "non-interactive by design" back when `npx @magic-spells/puzzle
init` was the expected front door and a separate `create-puzzle-app` wrapper
(clack-prompts UI, unpublished) was going to own the guided experience. For the
public release the owner decided the installed CLI is the only blessed onboarding
path — the wrapper will likely never be published — so the two questions that
actually shape a new app (which template? TypeScript?) belong in `puzzle init`
itself. D76 had already broken the "CLI never interacts" seal with its TTY-gated
update notice, and the name prompt proved the pattern.

## Decision

**Prompt on a TTY for exactly the choices not given as flags; change nothing
anywhere else.**

- Same TTY gate as the existing name prompt; prompt order name → template →
  TypeScript.
- Template prompt offers `scaffold.Templates` with `default` on empty input;
  TypeScript is y/N defaulting to No. Both re-prompt on invalid input.
- An explicitly-passed `--template`/`--typescript` is never second-guessed.
- Non-TTY behavior is byte-identical to before: no prompts, silent defaults,
  app-name argument required. Pipes and CI can never hang.

## Alternatives rejected

- **Publish `create-puzzle-app` for the guided flow**: a second package to
  version, maintain, and keep in lockstep for two questions; also splits the
  onboarding story the README just unified around the installed CLI.
- **A full TUI wizard (bubbletea/huh)**: new dependencies and a new interaction
  idiom for a two-question flow; the plain-text loop the name prompt already
  uses is enough.
- **Prompting even when flags are passed (confirm-style)**: breaks the
  flags-win convention every other command follows and slows scripted-but-TTY
  use for zero information.

## Consequences

Additive CLI behavior; compiler, runtime, and grammar untouched. §13's
"non-interactive by design" sentence is amended in place to point here. The
scaffolded output for any given (name, template, typescript) triple is unchanged
— prompts only choose the inputs. Ships in 0.1.1, the first post-launch release.
