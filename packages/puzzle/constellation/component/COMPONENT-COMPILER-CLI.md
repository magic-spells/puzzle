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
  - FILE-STANDALONE-COMPILE
  - DECISION-D194-VITEST-PLUGIN
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# Compiler CLI

The Cobra command surface in the platform binary (`compiler/cmd/puzzle`, one file per
command, each self-registering in `init()`). The user-facing contract — every command,
flag, default and message — is [[DOC-SPEC-BUILD]] §13 and the sections it points to;
this card holds the implementation rules behind it.

## Command wiring

- **Root.** `SilenceUsage`/`SilenceErrors`: `main()` prints the error and exits 1.
  The root `PersistentPreRunE` turns `--no-color` into `NO_COLOR=1` for every printer and
  child process, so **no subcommand may define its own `PersistentPreRunE` without
  chaining it**. `main()` also scans argv for `--no-color` before parsing, so usage errors
  print uncoloured.
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
  output. `-y/--yes` is a persistent
  flag on `upgrade` so `upgrade skills -y` works.
- **Runtime preflight.** `build` and `dev` call `build.PreflightRuntime` before any esbuild
  work: first `os.Stat` the directory (`directory not found` / `is not a directory`, not
  bypassable by `PUZZLE_RUNTIME`), then `build.PairRuntime`. With no runtime source
  (`PUZZLE_RUNTIME`, the in-repo walk, the installed package) it stops with one message
  naming `<pm> install` from the nearest lockfile. Rejected: auto-installing (the CLI never
  touches `node_modules` or the network, would guess the manager, and could install a
  mismatched runtime).
- **Version pair** ([[DECISION-D202-CLI-RUNTIME-VERSION-PAIR]]). `build.PairRuntime` takes
  the sources in that order and compares only an installed package: `build.PairInstalled`
  reads its version (`update.PackageVersion`) and, across a breaking release
  (`update.Breaking`, both shared with `upgrade`), returns the message naming both
  versions. `check` (and `check --fix`), every `generate` kind and `add piece` never bundle,
  so they call `build.PairRuntime` alone, before they read or write source: a mismatch stops
  them, and a missing runtime does not, so they run right after `init`. `doctor` calls
  `build.PairInstalled` for its runtime row. `preview` and the other `add` kinds do not
  compare versions.
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
  back to itself. tsc runs as `node <dir>/node_modules/typescript/bin/tsc` (`<dir>` = the
  app or the nearest ancestor with it, `fsutil.FindUp`), never a `.bin` shim or
  `cmd.exe`, so spaces in Windows paths work. The not-a-project test runs before the
  missing-tsc test.
- **`check --fix`** ([[DECISION-D199-UPGRADE-PASS]], `internal/codemod`) — the upgrade pass
  runs before the type check, so old code is named for what changed instead of surfacing
  as type errors. Without `--fix`, found sites are listed and `check` exits non-zero.
  `--fix` rewrites them in place and lists the sites it can't rewrite safely; with no
  TypeScript installed it then skips the type check with a note, not a failure.
- **`--fixtures`** (D98) — `build/fixtures.go` writes the wrapper under `.puzzle/fixtures/`;
  [[DECISION-D153-PUZZLE-SCRATCH-DIR]].
- **`init`** — embedded `default`/`static` trees plus `-ts` overlays (`starters/`, written
  by `internal/scaffold`); writes `tsconfig.json` or `jsconfig.json`, never both. TTY
  prompts (D77) are gated on a real isatty check AND no `--yes`.
- **`generate`** — `IsTypeScriptApp` (a root `tsconfig.json`) switches every stub. Reserved
  marker names are refused for components and `Component` for every `.pzl` scaffold
  (D180), with a rename hint before any write. Family collisions are all-or-nothing;
  `--force` rewrites only the family's files. The `--path` containment guard resolves
  symlinks (`fsutil.EvalSymlinksAllowMissing`, shared with pieces). `generate` and `add`
  hand `--dir` (empty = the working directory) straight to `generate.FindProjectRoot`,
  which makes it absolute itself.
- **`add piece` / `add theme`** (`internal/pieces`) — the theme fetch and `pieces.lock`
  parse finish before the first write; the lock is read before `planTheme` so the
  stale-theme hint can tell an older registry copy from a local edit. `planTheme` counts
  only the hand-merge marker, a live `@import` of `pieces.css` (`piecesCssImported`; a
  comment that mentions the file is not wiring) or the package import as "already wired",
  so `add piece` and `add theme` agree about the same styles.css. Dependency specs
  carry a version floor (D169): split on the LAST `@`, merged by package name keeping the
  highest floor. The manifests' `styles` are unioned in resolution order (`collectStyles`:
  first occurrence wins, never sorted, because each manifest lists its sheets in load
  order) and printed as one `@import "<spec>" layer(components);` step each, the first
  after `@import "tailwindcss";` and each later one after the line before it.
  `add theme` lives in `internal/pieces/themes.go`.
- **`add deploy`** ([[DECISION-D198-DEPLOY-TEMPLATES]], `add_deploy.go`) — the templates
  are embedded from the package's `deploy/` folder. `--static`/`--hybrid` picks the
  template, else the config's `output`; a config that fails to load is an error, never a
  guess. Each host writes one file under the template's own name, and a clash without
  `--force` is refused before anything is written.
- **`add skills` / `upgrade skills`** ([[DECISION-D78-AGENT-SKILL-DISTRIBUTION]]) —
  symlinked destinations are written through only under `--force`, never removed.
- **`upgrade`** ([[DECISION-D76-CLI-UPGRADE]]) — `detectInstallContext` classifies the
  running binary from its executable only. `upgradeScopes` lists the scopes, global first:
  the running binary is its own scope when it is a global or project install, a workspace
  or nested binary leaves the project out, and every other scope comes from disk
  (`installedGlobal`, and `projectAt` from the cwd). Every scope goes through
  `printScope`, `question` and `upgradeScope`, and `installed()` names the copy each one
  reports; a project's is looked up afresh each call, so the read-back finds it wherever
  the install put it. One walk, `upward`, finds a project's `package.json`, lockfile and
  copy, and stops at home or the filesystem root. `confirmUpgrade` is the prompt seam.
  `upgradedBinaryCandidates` + `binaryReportsVersion` prove the new binary before the
  skill re-exec (`add skills --force`).
  `platformPackageNameFor`/`platformBinaryNameFor` take GOOS/GOARCH explicitly (Node
  spelling: `win32`, `x64`; win32-arm64 folds onto x64) so every target is testable from
  one host.
- **Passive update notice** (`internal/update`, `updatecheck.go`) — gates are checked in
  `printUpdateNotice` before `CheckPassive`; the detached helper is the hidden
  `update-check` subcommand.

## Rules

- **D3 boundary**: add/generate never parse or rewrite user JavaScript and never install
  npm dependencies; `check` resolves the app's own `tsc` and never installs one. The one
  command that edits user source is `check --fix`, and only with the idempotent D199
  rewrites: the router `<Slot/>` → `<Outlet/>` (or `<Children/>` in a component),
  `setData(` → `setState(`, positional `data()`/`share()` → the one-object form, and the
  `formatters` key and `app/formatters.js` → `functions`.
- **Piece registries are untrusted**: no absolute/parent traversal in target/file/lib/theme
  paths, no symlink escape from the app or (local fetches) the registry root.
- Atomic writes where a partial artifact would hurt. TTY gates use a real isatty check —
  `/dev/null` is a character device, not a terminal, so prompts never block under CI.
- `pzlc` (`cmd/pzlc`) is the test/tooling single-file compiler with explicit mode; not the
  app workflow.
- The hidden `puzzle compile <file.pzl>` (`cmd/puzzle/compilecmd.go`) shares pzlc's
  pipeline (`internal/standalone`) but compiles under the file's path from the project
  root, the name the build uses, so the D20 mode and the `<style scoped>` id match the
  build; its one caller is the `/vitest` plugin, so app tests can import `.pzl` (D194).
- Flag-convention tests live in `cmd/puzzle/cli_conventions_test.go`.
