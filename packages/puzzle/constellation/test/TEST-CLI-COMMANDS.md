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
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D165-PUZZLE-CHECK
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DOC-TESTING
---

# CLI commands, scaffolds, and pieces

Covers the `puzzle` binary's command surface and the code it writes into user
projects. Packages: `compiler/cmd/puzzle` and
`compiler/internal/{scaffold,generate,pieces,update,check}`. Run from
`packages/puzzle` with `go test ./compiler/cmd/... ./compiler/internal/...`.

- **Commands:** `init` with its prompts, `add` including skills installation,
  `doctor`, `info`, `generate`, `upgrade` resolving its install context from the
  running executable (not the working directory), the output-mode flags, the
  build summary banner, and the profile flag.
- **`puzzle check`** (`internal/check`, [[DECISION-D165-PUZZLE-CHECK]]): the
  TypeScript emitter and runner, library signatures agreeing with codegen and
  the public types, and value/call positions checked. The live cases run a real
  `tsc` and skip when `node` or the package's `typescript` is missing.
- **Scaffolding and generation:** the embedded templates (JS and `-ts` variants)
  and the view/component/layout/model generators. Generated `.pzl` is compiled in
  test, so a template that drifts from the grammar fails here, not in a user's
  first `puzzle dev`. `TestGenerateRejectsReservedComponentName` pins the D180
  rejection and rename hint for component/view/layout/family-root/family-member
  scaffolds in JS and TS apps, and verifies the refusal creates no files.
- **The embedded agent skill:** `skill_examples_test.go` compiles every template
  example `skills/puzzle/SKILL.md` presents as working (each ```` ```html ````
  block and each inline template span) and requires the spans it shows as
  compile errors to fail ([[DECISION-D176-EXPRESSION-LANGUAGE]]), so the skill
  cannot teach syntax the compiler rejects, or vice versa.
- **Pieces:** registry resolution and the npm transport — version-locking the
  pieces package to the CLI's major.minor, the older-only fallback with its
  notice, and the lock file. Gotcha: `PUZZLE_PIECES_REGISTRY` overrides the
  transport, so a shell exporting it at a local checkout changes what these
  paths resolve against outside the test harness.
