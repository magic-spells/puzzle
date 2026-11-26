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
  - DECISION-D198-DEPLOY-TEMPLATES
  - DECISION-D199-UPGRADE-PASS
verified_at: '2026-11-26T05:26:02.017Z'
verified_sha: 2f5f6d0cebefc1d6b3c8f4cde3f4b4795d3e78c3
---

# CLI commands, scaffolds, and pieces

The `puzzle` binary's command surface and the code it writes into user projects.
Packages: `compiler/cmd/puzzle` and `compiler/internal/{scaffold,generate,pieces,update,check,codemod}`.
Run from `packages/puzzle` with `go test ./compiler/cmd/... ./compiler/internal/...`.

- **Commands**: `init` with its prompts, `add` (skills included), `doctor`, `info`,
  `generate`, `upgrade`, the output-mode flags, the build summary, the profile flag, and the runtime
  preflight. `cli_conventions_test.go` pins flag conventions against the real registered
  commands: `--force`/`-f` on `add` and `generate`, `--overwrite` as a silent hidden
  alias (a 0.9 `upgrade` re-execs the new binary with it, so it must not print a
  deprecation), persistent `--yes`, `build -m`/`-q` (quiet suppresses the summary),
  `--port`/`--host`, `--no-color`, `version` matching `--version`, `create` writing the same app
  as `init` (`TestCreateIsInit`), and stable
  `info --json` / `doctor --json` keys. A renamed or dropped flag fails here, not in
  someone's script.
- **The version pair** ([[DECISION-D202-CLI-RUNTIME-VERSION-PAIR]]):
  `TestPreflightRuntimeVersionPair` and `TestPreflightRuntimeVersionPairSkipsDevelopmentSources`
  (`internal/build`), `TestDoctorRuntimeVersion`, `TestCheckFixStopsOnAMismatchedInstall`, and
  `TestWritingCommandsPairWithTheInstall` for `generate` and `add piece`. The `cmd/puzzle`
  `TestMain` clears `PUZZLE_RUNTIME`, because a developer's export would skip the comparison.
- **`doctor`'s Node floor**: `TestDoctorNodeFloor` fails Node below 24 and passes 24.
- **`puzzle upgrade`** (`upgrade_test.go`, D76): the running binary's install context
  from the executable, never the cwd; both scopes listed and asked about, one scope, and
  up to date; `--check`, `--yes`, and a run without a terminal from either binary; the
  breaking-release wording (the boundary itself is `TestBreakingBoundary` in
  `internal/update`); a project above the cwd named in the row and the question
  before the install; the project walk stopping at the nearest `package.json`, at home,
  and at one that does not parse; npm and pnpm workspace members; a project with nothing
  installed; the skill-refresh binary for a global found on disk (npm -g and pnpm -g);
  and each refusal still offering the global CLI.
- **`puzzle add deploy`** (`add_deploy_test.go`, D198): the host list, refuse then
  `--force`, the `output` and public-folder rules, and each host's routing and cache headers.
- **`puzzle check --fix`** (`internal/codemod/codemod_test.go`, `checkcmd_test.go`, D199):
  a dry run lists the sites and writes nothing, the fix is idempotent, and
  `app/functions.js` is never overwritten. `TestCheckFixReportsWhatStoppedIt` also pins that
  an editor lock link (`.#Default.pzl`) stops neither the pass nor the type check.
- **`puzzle compile`** (`compilecmd_test.go`): the hidden command the `/vitest` plugin runs.
- **`puzzle check`** (`internal/check`, D165): the TypeScript emitter and runner,
  library signatures agreeing with codegen and the public types, value and call
  positions. The live cases run a real `tsc` and skip when `node` or the package's
  `typescript` is missing.
- **Scaffolding and generation**: the embedded templates (JS and `-ts`) and the
  view/component/layout/model generators. Generated `.pzl` is compiled in the test, so a
  template that drifts from the grammar fails here, not in a user's first `puzzle dev`.
  `TestGenerateRejectsReservedComponentName` pins the D180 refusal (no files written) for
  every scaffold kind in JS and TS apps. `TestEveryTemplateShipsATestSuite` pins the test
  suite every template ships. `TestScaffoldDefaultBuilds`, `TestScaffoldStaticBuilds` and
  their `…TypeScriptBuildsAndChecks` twins build each starter (the static one must write
  `index.html`, `about/index.html` and `404.html`) and run `puzzle check` on the
  TypeScript ones.
- **The embedded agent skill**: `skill_examples_test.go` compiles every template example
  `skills/puzzle/SKILL.md` presents as working and requires the ones it shows as errors to
  fail, so the skill cannot teach syntax the compiler rejects.
- **Pieces**: registry resolution and the npm transport: the version lock to the CLI's
  major.minor (`TestSelectVersionPicksHighestLockstepPatch`,
  `TestNpmFetcherResolvesLockstepAndFetches`), the error when no release matches it
  (`TestNpmFetcherNoMatchNamesTheBoundary`; `TestAddRefusesPiecesAcrossBreakingRelease`:
  nothing written, for `add piece` and `add theme`), the lock file, and the manifests'
  `styles` printed in load order (`TestAddPiecePrintsStylesInLoadOrder`).

Release scripts have JS suites: `tests/release-checks.test.js` (packed-binary problems,
tag reminder lines, README status line) and `tests/bin-shim-resolver.test.js`
(`bin/puzzle.js` platform resolution).

Gotcha: `PUZZLE_PIECES_REGISTRY` overrides the pieces transport, so a shell that exports
it at a local checkout changes what pieces resolve against outside the test harness.
