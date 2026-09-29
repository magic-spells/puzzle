---
name: 'D32 — CLI tooling: init, generate, add, doctor, info'
status: verified
verified_at: '2026-08-24T19:03:19.035Z'
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
  - compiler/internal/scaffold/templates/default/package.json
  - compiler/internal/scaffold/templates/todos/package.json
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D32 — CLI tooling: `init`, `generate`, `add`, `doctor`, `info`

The scaffolding and tooling commands beside `dev`/`build` ([[DECISION-D13-CLI-DEV-BUILD]]). See [[DOC-SPEC-BUILD]] §13 and [[COMPONENT-COMPILER-CLI]].

## Decision
- **`puzzle init <app-name> [--template default|todos] [--typescript] [--dir <parent>]`** scaffolds a Tailwind-first app (`app/` source, `app/app.js` or `app/app.ts` entry). Names are validated npm-safe; a non-empty target is refused. It prompts only on a real terminal, for flags not passed explicitly ([[DECISION-D77-INIT-PROMPTS]]); under a pipe or CI nothing is prompted and a missing name is an error.
- **`puzzle generate <component|view|layout|model> <Name> [--path <dir>] [--force]`** (alias `g`) stubs into `app/components|views|layouts|models`, finding the project root by walking up for `package.json`/`puzzle.config.js`. TypeScript apps get TypeScript stubs ([[DECISION-D54-TYPESCRIPT-SCRIPTS]]).
- **`puzzle add tailwind`** writes `puzzle.config.js` + `app/styles/styles.css` when absent.
- **`puzzle add piece <name…>`** copies pieces from the puzzle-pieces registry (`compiler/internal/pieces`):
  - Registry source: `--registry` → `PUZZLE_PIECES_REGISTRY` → the `@magic-spells/puzzle-pieces` npm package, resolved to the newest release matching the CLI's major.minor, else the newest **older** compatible release with a notice naming both versions (never newer — a later registry may use grammar this binary lacks). Only when nothing older exists is it a hard error listing published versions in numeric order. `--pieces-version` pins exactly.
  - Files copy **verbatim** (never stamped, so they stay diffable against the registry). `pieces.lock` records a sha256 per copied file, the resolved registry source and the `puzzle` version of the last add — provenance, never a range anything resolves against.
  - The registry theme is copied verbatim to `app/styles/pieces.css` (locked by hash) when the app has neither the tokens nor the file; only the `@import './pieces.css';` line stays a printed step, because `styles.css` is user-owned.
  - Overwrite refusal is all-or-nothing: a pre-flight lists every conflict before any write.
  - The npm install line is **printed, never run** ([[DECISION-D169-REGISTRY-VERSION-FLOORS]] shapes it).
- **`puzzle doctor [dir]`** runs ✓/✘/! environment checks (node, entry, `index.html`, config load, Tailwind CLI resolution, runtime package) and exits 1 on any failure. **`puzzle info [dir]`** prints versions, platform, project root, source/output dirs and the styles pipeline. `puzzle --version` reads `internal/version`.

## Rules
- **`add`/`generate` never rewrite user JavaScript** ([[DECISION-D03-SCRIPTS-REAL-JS]]): model `generate` does not edit `app/models/index.js`, and an existing `puzzle.config.js` is never rewritten; the needed registration is printed as an exact snippet.
- **Templates are real embedded file trees** under `compiler/internal/scaffold/templates/` (`go:embed`, `__APP_NAME__` substituted at write time).
- **Generated `.pzl` stubs are compile-checked** against the repo's own parser + codegen in tests, so the generators cannot drift from the language.
- Each command registers itself from its own file in `compiler/cmd/puzzle/`; logic lives in `internal/scaffold` and `internal/generate`.
- The scaffolded `package.json` pins `@magic-spells/puzzle` at the binary's release, and `release:prep` asserts it: a caret range does not cross a 0.x minor, and the embedded templates can only be corrected by rebuilding every platform binary.

## Alternatives rejected
- Auto-wiring by parsing/rewriting the user's JS — the JS parsing the Go compiler refuses to own.
- String-building scaffold files in Go — real files stay diffable, editable and testable.
- Prompting regardless of the stream — hangs CI, pipes and `npx` one-liners.
