---
name: "D32 — CLI tooling: init/generate/add/doctor/info (v1.4)"
status: verified
verified_at: '2026-08-24T19:03:19.035Z'
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DECISION-D13-CLI-DEV-BUILD
  - DECISION-D03-SCRIPTS-REAL-JS
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
notes:
  - kind: verified
    text: >-
      init prompts, pieces.lock fields, and the scaffold dependency range re-truthed against
      initcmd.go, pieces/lock.go and the templates.
    sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D32 — CLI tooling: init/generate/add/doctor/info (v1.4)

The full scaffolding/tooling CLI surface — `init`, `generate`, `add`, `doctor`, `info` (plus `--version`) — lands additively on top of `dev`/`build`, with no compiler or runtime-kernel change. Settled (v1.4); see [[DOC-SPEC-BUILD]] §13 and [[COMPONENT-COMPILER-CLI]].

## Context
[[DECISION-D13-CLI-DEV-BUILD]] shipped v1's CLI as just `puzzle dev` + `puzzle build` and deferred `init`/`generate`/`add`/`doctor`/`info` post-v1. D32 lands all five — the full scaffolding/tooling surface [[DOC-SPEC]] §11 promised — additively like D28–D31: no new SPEC directive, no compiler or runtime-kernel change, and `dev`/`build` behave exactly as before.

## Decision

- **`puzzle init <app-name> [--template default|todos] [--dir <parent>]`** scaffolds a complete Tailwind-first app (`app/` source, `app/app.js` entry) per [[DOC-SPEC]] §11. `default` is a minimal starter (Default layout, Home view, a Counter component demonstrating `setData` + arrow-function events); `todos` is the todos example app. Names are validated npm-safe; a non-empty target dir is refused.
- **`puzzle generate <component|view|layout|model> <Name> [--path <dir>] [--force]`** (alias `g`) stubs into `app/components|views|layouts|models`, locating the project root by walking up for `package.json`/`puzzle.config.js`. PascalCase names for `.pzl` types, lowercase for models.
- **`puzzle add tailwind`** writes the canonical `puzzle.config.js` + `app/styles/styles.css` when absent.
- **`puzzle add piece <name…>`** (amendment, 2026-07-17 — settled with Cory, superseding puzzle-pieces PLAN.md's "standalone npx CLI first" note): copies pieces from the puzzle-pieces registry (`compiler/internal/pieces`). Registry source = `--registry` flag → `PUZZLE_PIECES_REGISTRY` env → the `@magic-spells/puzzle-pieces` npm package default, resolved to the newest release matching the CLI's major.minor — else the newest OLDER compatible release with a printed notice naming both versions (never newer: a later registry may use grammar this binary lacks), and a hard error listing published versions in true numeric order only when nothing older exists — so zero-config `add piece` survives a pieces release lagging the CLI (`--pieces-version` pins it exactly), and it works pre-publish against a local checkout. Files copy VERBATIM (never stamped — copies stay diffable against the registry); `pieces.lock` records a sha256 content hash per copied file (hashes, not version numbers, for the piece contents: nothing to bump, and a future `diff`/`update` can tell upstream-changed from locally-customized), plus the resolved registry source and the `puzzle` version that performed the last add — provenance that makes a bug report exact, never a range anything resolves against. D3 holds: the npm install line is PRINTED, never executed. The registry THEME is treated as registry content: auto-copied verbatim to `app/styles/pieces.css` when the app has neither the tokens nor the file (locked with a hash like any piece, so a future update can track it); only the one-line `@import './pieces.css';` wiring stays a printed step, because styles.css is user-owned. Overwrite refusal is all-or-nothing (pre-flight lists every conflict before any write; an existing pieces.css is skipped, never a conflict).
- **`puzzle doctor [dir]`** runs ✓/✘/! environment checks (node on PATH, `app/app.js`, `index.html`, config load, Tailwind CLI resolution, runtime package presence) and exits 1 on any failure; **`puzzle info [dir]`** prints puzzle version, platform, node version, project root, source/output dirs, and the declared styles pipeline. `puzzle --version` is wired to `internal/version`.

Sub-decisions, each with its rejected alternative:

- **`init` is scriptable by default and interactive only on a TTY.** Under a pipe or in CI nothing is ever prompted: zero args hard-errors `app name required` and every unset flag keeps its default, so scripts never hang. On a real terminal `init` prompts for the app name when the positional is omitted (re-prompting through `scaffold.ValidateName` until valid), and for `--template` and `--typescript` when those flags were not passed explicitly — an explicit flag is authoritative and never second-guessed. (Rejected: prompting regardless of the stream — see Alternatives rejected.)
- **`add`/`generate` never rewrite user JavaScript ([[DECISION-D03-SCRIPTS-REAL-JS]]).** Model `generate` does **not** edit `app/models/index.js`; an existing `puzzle.config.js` is never rewritten by `add tailwind` (already-declared → no-op, otherwise the exact snippet + install line print as a manual step). The registration/config the author must add is **printed as an exact snippet** instead. (Rejected: auto-wiring by parsing/rewriting the user's JS — see Alternatives rejected.)
- **Templates are embedded real file trees, not strings built in Go.** Each template is a real directory under `compiler/internal/scaffold/templates/`, embedded via `go:embed` with `__APP_NAME__` substituted at write time. (Rejected: string-building the scaffolded files inside Go — see Alternatives rejected.)
- **Generated `.pzl` stubs are compile-checked against the repo's own compiler.** A test runs every generated `.pzl` through the repo's parser + codegen, so a grammar change that would break a stub breaks the test — the generators cannot drift from the language.
- **Each command self-registers from its own file.** `initcmd.go`/`generate.go`/`add.go`/`doctor.go`/`info.go` in `compiler/cmd/puzzle/` each register onto the root command; logic lives in `compiler/internal/scaffold` and `compiler/internal/generate`. `main.go` is untouched and no new Go dependencies were added.

## Alternatives rejected

- **Prompting regardless of the stream** (the old aspirational CLAUDE.md text promised unconditional template/styling prompts): rejected — every prompt is gated on a real terminal on stdin, so CI, pipes, and `npx` one-liners stay fully scriptable and never block on a question they cannot answer.
- **Auto-wiring by parsing/rewriting the user's JS:** reintroduces exactly the JS-parsing the Go compiler refuses to own ([[DECISION-D03-SCRIPTS-REAL-JS]]).
- **String-building the scaffolded files inside Go:** rejected — real files stay diffable, editable, and testable as the app they produce.

## Consequences

The scaffolded `package.json` pins `@magic-spells/puzzle` at the release its binary ships with, so that range is part of the release sweep `release:prep` asserts: a caret range does not cross a 0.x minor, so a stale pin installs an older runtime into an app scaffolded by a newer CLI. Because the templates are `go:embed`ed, correcting it means rebuilding every platform binary — a JS-only republish cannot carry it.

Non-breaking: `dev`/`build` are unchanged; this is an additive amendment (v1.4).
