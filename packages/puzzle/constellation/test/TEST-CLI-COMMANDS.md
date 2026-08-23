---
name: CLI commands, scaffolds, and pieces
kind: integration
status: built
framework: go test
connections:
  - COMPONENT-COMPILER-CLI
  - FILE-CLI
  - FILE-CLI-ADD
  - FILE-SCAFFOLD
  - FILE-GENERATE
  - FILE-PIECES
  - DECISION-D11-PROJECT-LAYOUT
  - DECISION-D13-CLI-DEV-BUILD
  - DECISION-D32-CLI-TOOLING
  - DECISION-D76-CLI-UPGRADE
  - DECISION-D77-INIT-PROMPTS
  - DECISION-D78-AGENT-SKILL-DISTRIBUTION
  - DECISION-D80-REGISTRY-ACCEPT-HEADER
  - DECISION-D97-UPGRADE-SKILL-REFRESH
  - DECISION-D99-SKILL-REFRESH-PROMPT
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - FEATURE-V1-4-CLI-TOOLING
  - DOC-TESTING
---


# CLI commands, scaffolds, and pieces

Covers the `puzzle` binary's command surface and the code it writes into user
projects.

Commands: `init` with its prompts, `add` including skills installation, `doctor`,
`info`, `generate`, `upgrade` resolving its install context from the running
executable rather than the working directory, the output-mode flags, the build
summary banner, and the profile flag.

Scaffolding and generation: the embedded project templates and the generators
that emit views, components, layouts, and models. Generated `.pzl` output is
compiled in test, so a template that drifts from the grammar fails here rather	han in a user's first `puzzle dev`.

Pieces: registry resolution and the npm transport — version-locking the pieces
package to the CLI's major.minor, the older-only fallback with its printed
notice, and the lock file. `PUZZLE_PIECES_REGISTRY` overrides the transport, so
a shell that exports it at a local checkout changes what these paths resolve
against outside the test harness.

Covers 14 `*_test.go` files across `compiler/cmd/puzzle` and
`compiler/internal/{scaffold,generate,pieces,update}`.
