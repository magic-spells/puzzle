---
name: Compiler CLI
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - COMPONENT-SSG
  - FILE-CLI
  - FILE-CLI-ADD
  - FILE-SCAFFOLD
  - FILE-GENERATE
  - FILE-PIECES
  - FILE-PZLC
verified_at: '2026-11-01T19:26:04.240Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Compiler CLI

The Cobra command surface in the platform binary (`compiler/cmd/puzzle`, one file per
command, each self-registering in `init()`). The user-facing contract — every command,
flag, default and message — is [[DOC-SPEC-BUILD]] §13 and the sections it points to;
this card holds the implementation rules behind it.

## Command wiring

- **Root.** `SilenceUsage`/`SilenceErrors`: `main()` prints the one error line and exits 1.
  The root `PersistentPreRunE` turns `--no-color` into `NO_COLOR=1` for every printer and
  child process, so **no subcommand may define its own `PersistentPreRunE` without
  chaining it**. `main()` also scans argv for `--no-color` before parsing, so usage errors
  print uncoloured (`ui.ColorAllowed()` exposes the env gate).
- **Version.** `version.go` holds the one `versionTemplate` (`{{.Name}} version
  {{.Version}}`) shared by `--version`/`-v` and the `version` subcommand. The version must
  stay the LAST field: upgrade's `binaryReportsVersion` reads it.
- **`--host`** (`serveflags.go`, dev/preview). pflag gives optional values only to
  `--host=`, so `main()` runs `normalizeHostArgs` first, rewriting `--host <ip>` to
  `--host=<ip>` only for the token immediately after a bare `--host` that is an IP literal
  or `localhost`. A custom `hostValue` (NoOptDefVal sentinel, Type `bool` so help shows no
  `[=…]`) records a bare flag; `serve.BindHost`/`serve.Banner` map it to the bind address
  and the banner URLs.
- **Compatibility aliases.** `add --overwrite` (bound to the same var as `--force`) and
  `init --dir` use `MarkHidden`, not `MarkDeprecated`: a 0.9 `puzzle upgrade` re-execs the
  new binary with `add skills --overwrite`, and a deprecation notice would land in its
  output. `check --js` is hidden and errors as not implemented. `-y/--yes` is a persistent
  flag on `upgrade` so `upgrade skills -y` works.
- **Runtime preflight.** `build` and `dev` call `build.PreflightRuntime` before any esbuild
  work: first `os.Stat` the directory (`directory not found` / `is not a directory`, not
  bypassable by `PUZZLE_RUNTIME`), then require one runtime source (`PUZZLE_RUNTIME`, the
  in-repo walk, the installed package); otherwise one message naming `<pm> install` from
  the nearest lockfile. Rejected: auto-installing (the CLI never touches `node_modules` or
  the network, would guess the manager, and could install a mismatched runtime).
  `check`/`generate`/`preview` never bundle and are not gated.
- **`build -q`** sets `build.Options.Quiet`, which gates the internal/build page report as
  well as the CLI summary and update notice.
- **`--profile-build`** reads `PUZZLE_PROFILE_BUILD=1` too (that is how dev static
  rebuilds get profiled); tables go to stderr; disabled, the profiler is a nil pointer.

## Per-command notes

- **`dev`** → [[COMPONENT-DEV-SERVER]]; port scan [[DECISION-D90-DEV-PORT-SCAN]]; static
  dev [[DECISION-D148-PREVIEW-AND-STATIC-DEV]], [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]].
- **`preview`** — `internal/preview` over the shared `internal/serve` resolver; no watcher.
- **`check`** ([[DECISION-D165-PUZZLE-CHECK]]) — `internal/check`. The JS mirror is
  `.pzl.script.js`: the `.script` infix stops TypeScript resolving the wrapper's import
  back to itself. tsc runs as `node <app>/node_modules/typescript/bin/tsc`, never a `.bin`
  shim or `cmd.exe`, so spaces in Windows paths work. The not-a-project test runs before
  the missing-tsc test.
- **`--fixtures`** (D98) — `build/fixtures.go` writes the wrapper under `.puzzle/fixtures/`;
  [[DECISION-D153-PUZZLE-SCRATCH-DIR]].
- **`init`** — embedded `default`/`todos` trees plus `-ts` overlays (`internal/scaffold`);
  writes `tsconfig.json` or `jsconfig.json`, never both. TTY prompts (D77) are gated on a
  real isatty check AND no `--yes`.
- **`generate`** — `IsTypeScriptApp` (a root `tsconfig.json`) switches every stub. Reserved
  marker names are refused for components and `Component` for every `.pzl` scaffold
  (D180), with a rename hint before any write. Family collisions are all-or-nothing;
  `--force` rewrites only the family's files. The `--path` containment guard resolves
  symlinks (`evalSymlinksAllowMissing`, in lockstep with pieces).
- **`add piece` / `add theme`** (`internal/pieces`) — the theme fetch and `pieces.lock`
  parse finish before the first write; the lock is read before `planTheme` so the
  stale-theme hint can tell an older registry copy from a local edit. Dependency specs
  carry a version floor (D169): split on the LAST `@`, merged by package name keeping the
  highest floor. `add theme` lives in `internal/pieces/themes.go`.
- **`add skills` / `upgrade skills`** ([[DECISION-D78-AGENT-SKILL-DISTRIBUTION]]) —
  symlinked destinations are written through only under `--force`, never removed.
- **`upgrade`** ([[DECISION-D76-CLI-UPGRADE]]) — `detectInstallContext` classifies from
  the running executable only; `upgradedBinaryCandidates` + `binaryReportsVersion` prove
  the new binary before the skill re-exec (`add skills --force`).
  `platformPackageNameFor`/`platformBinaryNameFor` take GOOS/GOARCH explicitly (Node
  spelling: `win32`, `x64`; win32-arm64 folds onto x64) so every target is testable from
  one host.
- **Passive update notice** (`internal/update`, `updatecheck.go`) — gates are checked in
  `printUpdateNotice` before `CheckPassive`; the detached helper is the hidden
  `update-check` subcommand.

## Rules

- **D3 boundary**: add/generate never parse or rewrite user JavaScript and never install
  npm dependencies; `check` resolves the app's own `tsc` and never installs one.
- **Piece registries are untrusted**: no absolute/parent traversal in target/file/lib/theme
  paths, no symlink escape from the app or (local fetches) the registry root.
- Atomic writes where a partial artifact would hurt. TTY gates use a real isatty check —
  `/dev/null` is a character device, not a terminal, so prompts never block under CI.
- `pzlc` (`cmd/pzlc`) is the test/tooling single-file compiler with explicit mode; not the
  app workflow.
- Flag-convention tests live in `cmd/puzzle/cli_conventions_test.go`.
