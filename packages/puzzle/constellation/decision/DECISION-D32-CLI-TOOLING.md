---
name: 'D32 — CLI tooling: init, generate, add, doctor, info'
status: verified
verified_at: '2026-11-26T05:26:02.017Z'
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DECISION-D13-CLI-DEV-BUILD
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D77-INIT-PROMPTS
  - DECISION-D169-REGISTRY-VERSION-FLOORS
code_refs:
  - compiler/cmd/puzzle/initcmd.go
  - compiler/cmd/puzzle/generate.go
  - compiler/cmd/puzzle/add.go
  - compiler/cmd/puzzle/doctor.go
  - compiler/cmd/puzzle/info.go
  - compiler/internal/scaffold/scaffold.go
  - compiler/internal/generate/generate.go
  - compiler/internal/pieces/fetcher.go
  - compiler/internal/pieces/npm.go
  - compiler/internal/pieces/pieces.go
  - compiler/internal/pieces/lock.go
  - starters/default/package.json
  - starters/static/package.json
  - scripts/starter-repos.mjs
verified_sha: 2f5f6d0cebefc1d6b3c8f4cde3f4b4795d3e78c3
---

# D32 — CLI tooling: `init`, `generate`, `add`, `doctor`, `info`

The scaffolding and tooling commands beside `dev`/`build` ([[DECISION-D13-CLI-DEV-BUILD]]). See [[DOC-SPEC-BUILD]] §13 and [[COMPONENT-COMPILER-CLI]].

## Decision

- **`puzzle init [app-name|path] [-t default|static] [--typescript] [-y]`** scaffolds a Tailwind-first app (`app/` source, `app/app.js` or `app/app.ts` entry). `puzzle create` is the same command (a cobra alias): most JavaScript tools start a project with "create", so both names work, and `init` stays the name in docs, messages and examples. A path such as `../apps/foo` creates `foo` inside `../apps` (`--dir <parent>` is a hidden alias). Names are validated npm-safe; a non-empty target is refused. It prompts only on a real terminal, for flags not passed explicitly ([[DECISION-D77-INIT-PROMPTS]]); under a pipe or CI nothing is prompted and a missing name is an error.
- **`puzzle generate <component|view|layout|model> <Name> [--path <dir>] [-f/--force] [--dir <app-root>]`** (alias `g`) stubs into `app/components|views|layouts|models`, finding the project root by walking up for `package.json`/`puzzle.config.js`. TypeScript apps get TypeScript stubs ([[DECISION-D54-TYPESCRIPT-SCRIPTS]]); `--family` scaffolds a component family ([[DECISION-D167-COMPONENT-FAMILIES]]). It stops first when the project's installed Puzzle is across a breaking release from this CLI ([[DECISION-D202-CLI-RUNTIME-VERSION-PAIR]]); with nothing installed it runs.
- **`puzzle add tailwind`** writes `puzzle.config.js` + `app/styles/styles.css` when absent. `add theme` is [[DECISION-D171-ADD-THEME]]; `add deploy` is [[DECISION-D198-DEPLOY-TEMPLATES]]; `add skills` is [[DECISION-D78-AGENT-SKILL-DISTRIBUTION]].
- **`puzzle add piece <name…>`** copies pieces from the puzzle-pieces registry (`compiler/internal/pieces`). Like `generate`, it stops first when the installed Puzzle is across a breaking release from this CLI, and runs with nothing installed.
  - Registry source: `--registry` → `PUZZLE_PIECES_REGISTRY` → the `@magic-spells/puzzle-pieces` npm package, resolved to the newest release matching the CLI's major.minor, never another minor. With no match it is a hard error listing published versions in numeric order, and nothing is written. The default-source hint names `--registry <path|url>` and `PUZZLE_PIECES_REGISTRY`, not `--pieces-version`: an older pin would install the release the lock just refused. `--pieces-version` pins exactly.
  - Files copy **verbatim** (never stamped, so they stay diffable against the registry). `pieces.lock` records a sha256 per copied file, the resolved registry source and the `puzzle` version of the last add — provenance, never a range anything resolves against.
  - The registry theme is copied verbatim to `app/styles/pieces.css` (locked by hash) when the app has neither the tokens nor the file; only the `@import './pieces.css';` line stays a printed step, because `styles.css` is user-owned.
  - Overwrite refusal is all-or-nothing: a pre-flight lists every conflict before any write; `-f/--force` overwrites.
  - The npm install line and the component stylesheet imports (the manifests' `styles`, one `@import "<spec>" layer(components);` line each, in load order) are **printed, never run** ([[DECISION-D169-REGISTRY-VERSION-FLOORS]] shapes the install line).
- **`puzzle doctor [dir]`** runs ✓/✘/! environment checks (node at the [[DECISION-D200-MINIMUM-NODE]] floor, entry, `index.html`, config load, Tailwind CLI resolution, runtime package with its installed version, failed with the build's message when that version is across a breaking release from this CLI) and exits 1 on any failure. **`puzzle info [dir]`** prints versions, platform, project root, source/output dirs and the styles pipeline. Both take `--json`. `puzzle --version` and `puzzle version` print the same stamped `internal/version`.

## Rules

- **`add`/`generate` never rewrite user JavaScript** ([[DECISION-D03-SCRIPTS-REAL-JS]]): model `generate` does not edit `app/models/index.js`, and an existing `puzzle.config.js` is never rewritten; the needed registration is printed as an exact snippet.
- **Templates are real embedded file trees** under `starters/` (`starters/embed.go`, `go:embed`, `__APP_NAME__` substituted at write time).
- **The starter repos are generated.** `npm run starter-repos` writes four repos as `puzzle init` output plus the package's MIT `LICENSE.txt` ([[FLOW-RELEASE]]): `magic-spells/puzzle-starter` (`default`), `magic-spells/puzzle-starter-static` (`static`), and the same two with `--typescript`, `magic-spells/puzzle-starter-ts` and `magic-spells/puzzle-starter-static-ts`. They carry no host config; each README points to `npx puzzle add deploy` for the host the clone uses. Each starter README links to its sibling in the other language and to the other template in the same language. The licence is never in `starters/`: an app `puzzle init` makes is its owner's to license. Change `starters/`, never those repos by hand.
- **Generated `.pzl` stubs are compile-checked** against the repo's own parser + codegen in tests, so the generators cannot drift from the language.
- Each command registers itself from its own file in `compiler/cmd/puzzle/`; logic lives in `internal/scaffold` and `internal/generate`.
- The scaffolded `package.json` pins `@magic-spells/puzzle` at the binary's release, and `release:prep` asserts it: a caret range does not cross a 0.x minor, and the embedded templates can only be corrected by rebuilding every platform binary.

## Alternatives rejected

- Auto-wiring by parsing/rewriting the user's JS — the JS parsing the Go compiler refuses to own.
- String-building scaffold files in Go — real files stay diffable, editable and testable.
- Prompting regardless of the stream — hangs CI, pipes and `npx` one-liners.
- Fall back to an older pieces release when the matching one is missing. Rejected: the framework and its pieces ship together at one version, and an older release may not compile.
- Ship host config files in the starter repos so a host builds a clone as is. Rejected: people deploy to many hosts, such as Cloudflare and Render; `puzzle add deploy <host>` writes the config for the one they pick.
- Only JavaScript starter repos, with TypeScript left to `puzzle init --typescript`. Rejected: many developers look for a TypeScript starter first.
- Rename `init` to `create`. Rejected: every doc, starter README and existing script uses `init`; the alias gives both names and breaks nothing.
