---
name: CLI commands, scaffolds, and pieces
kind: integration
status: verified
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
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# CLI commands, scaffolds, and pieces

The `puzzle` binary's command surface and the code it writes into user projects.
Packages: `compiler/cmd/puzzle` and `compiler/internal/{scaffold,generate,pieces,update,check}`.
Run from `packages/puzzle` with `go test ./compiler/cmd/... ./compiler/internal/...`.

- **Commands**: `init` with its prompts, `add` (skills included), `doctor`, `info`,
  `generate`, `upgrade` resolving its install context from the running executable (not
  the cwd), the output-mode flags, the build summary, the profile flag, and the runtime
  preflight. `cli_conventions_test.go` pins flag conventions against the real registered
  commands: `--force`/`-f` on `add` and `generate`, `--overwrite` as a silent hidden
  alias (a 0.9 `upgrade` re-execs the new binary with it, so it must not print a
  deprecation), persistent `--yes`, `build -m`/`-q` (quiet suppresses the summary),
  `--port`/`--host`, `--no-color`, `version` matching `--version`, and stable
  `info --json` / `doctor --json` keys. A renamed or dropped flag fails here, not in
  someone's script.
- **`puzzle check`** (`internal/check`, D165): the TypeScript emitter and runner,
  library signatures agreeing with codegen and the public types, value and call
  positions. The live cases run a real `tsc` and skip when `node` or the package's
  `typescript` is missing.
- **Scaffolding and generation**: the embedded templates (JS and `-ts`) and the
  view/component/layout/model generators. Generated `.pzl` is compiled in the test, so a
  template that drifts from the grammar fails here, not in a user's first `puzzle dev`.
  `TestGenerateRejectsReservedComponentName` pins the D180 refusal (no files written) for
  every scaffold kind in JS and TS apps.
- **The embedded agent skill**: `skill_examples_test.go` compiles every template example
  `skills/puzzle/SKILL.md` presents as working and requires the ones it shows as errors to
  fail, so the skill cannot teach syntax the compiler rejects.
- **Pieces**: registry resolution and the npm transport: version lock to the CLI's
  major.minor, the older-only fallback with its notice, the lock file.

Release scripts have JS suites: `tests/release-checks.test.js` (pieces fallback notice,
packed-binary problems, tag reminder lines) and `tests/bin-shim-resolver.test.js`
(`bin/puzzle.js` platform resolution).

Gotcha: `PUZZLE_PIECES_REGISTRY` overrides the pieces transport, so a shell that exports
it at a local checkout changes what pieces resolve against outside the test harness.
