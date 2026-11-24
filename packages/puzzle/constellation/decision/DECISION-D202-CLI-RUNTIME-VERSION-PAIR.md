---
name: >-
  D202 — The CLI and the installed runtime are on the same side of a breaking release, or the CLI
  stops
status: verified
code_refs:
  - compiler/internal/build/preflight.go
  - compiler/internal/update/update.go
  - compiler/cmd/puzzle/checkcmd.go
  - compiler/cmd/puzzle/generate.go
  - compiler/cmd/puzzle/add.go
  - compiler/cmd/puzzle/doctor.go
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - FILE-BUILD-OPTIONS
  - DECISION-D32-CLI-TOOLING
  - DECISION-D76-CLI-UPGRADE
  - DECISION-D165-PUZZLE-CHECK
  - DECISION-D199-UPGRADE-PASS
  - DOC-SPEC-BUILD
  - DOC-USER-GUIDE
  - DOC-RELEASE-SURFACE
  - TEST-CLI-COMMANDS
verified_at: '2026-11-24T18:13:45.766Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# D202 — The CLI and the installed runtime pair

The `puzzle` CLI and the project's installed `@magic-spells/puzzle` must be on the same side of a breaking release: a new minor while the major is 0, a new major after that (`update.Breaking`, the rule `puzzle upgrade` uses). When they are not, the CLI stops with a message instead of building. Versions that differ only in patch pass.

## Context

The compiler emits code for its own runtime, and the build takes the runtime from the project's `node_modules`. A global CLI run inside a project can therefore pair one release's compiler with another release's runtime, and nothing failed: a 0.9 CLI on a 0.10 app built a blank page and exited 0, and a 0.10 CLI on a 0.9 app let `puzzle check --fix` rewrite the source for a runtime that was not installed.

## Decision

- **`build.PairRuntime`** (`compiler/internal/build/preflight.go`) finds the runtime source in the build's order (`PUZZLE_RUNTIME`, the in-repo walk, the installed package) and compares only the installed one. `build.PairInstalled` reads that package's version with `update.PackageVersion` (shared with `puzzle upgrade`) and returns the error. The two development sources are not compared: `PUZZLE_RUNTIME` names a checkout on purpose, and an app inside this repo builds against the working tree. A version with no `major.minor` reads as not breaking.
- **The message** names both versions, the project's own CLI, and the upgrade for the older side:

  ```
  This project has Puzzle 0.9.0 installed, and this CLI is 0.10.0.
    Use the project's own CLI:  npm run dev, npm run build, or npx puzzle <command>
    Or upgrade the project:     puzzle upgrade
  ```

  When the CLI is the older one, the last line is `Or upgrade this CLI:` instead.
- **Which commands stop.** `build` and `dev` go through `build.PreflightRuntime`, which stops on a mismatch or when no runtime is found. `check` (with or without `--fix`), every `generate` kind and `add piece` call `build.PairRuntime` alone: they stop on a mismatch and run with nothing installed, so they work right after `puzzle init` (`scripts/verify-published.mjs` runs `add piece` before any install). `doctor` shows the installed version in its runtime package row and fails that row with the same message. `preview`, `info`, `init`, `upgrade` and the other `add` kinds do not compare versions.

## Alternatives rejected

- **The global command hands off to the project's own CLI when one is installed.** Which program runs becomes less obvious, and `upgrade` and `init` would need exceptions.
- **Warn and keep building.** The build succeeds with a blank page, so a warning in a scrolling log does nothing.
- **Compare inside `configureRuntime`.** It has no error path, and it runs on every esbuild pass and every dev rebuild.

## Consequences

- Only a 0.10 or later CLI can stop. An older global CLI still builds against the wrong runtime without a word, so the docs lead with `npm run dev`, `npm run build` and `npx puzzle <command>`, which always run the project's own CLI, and the CLI's hints say `npx puzzle check`.
- `generate` and `add piece` stop on a mismatch but still run before an install.
- A new command that compiles, checks or writes app source calls `build.PairRuntime` before its first write, or `build.PreflightRuntime` when it bundles.
