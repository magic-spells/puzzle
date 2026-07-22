---
name: "D32 — CLI tooling: init/generate/add/doctor/info (v1.4)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DECISION-D13-CLI-DEV-BUILD
  - DECISION-D03-SCRIPTS-REAL-JS
---

# D32 — CLI tooling: init/generate/add/doctor/info (v1.4)

The full scaffolding/tooling CLI surface — `init`, `generate`, `add`, `doctor`, `info` (plus `--version`) — lands additively on top of `dev`/`build`, with no compiler or runtime-kernel change. Settled (v1.4); see [[DOC-SPEC]] §13 and [[COMPONENT-COMPILER-CLI]].

## Context
[[DECISION-D13-CLI-DEV-BUILD]] shipped v1's CLI as just `puzzle dev` + `puzzle build` and deferred `init`/`generate`/`add`/`doctor`/`info` post-v1. D32 lands all five — the full scaffolding/tooling surface [[DOC-SPEC]] §11 promised — additively like D28–D31: no new SPEC directive, no compiler or runtime-kernel change, and `dev`/`build` behave exactly as before.

## Decision
- **`puzzle init <app-name> [--template default|todos] [--dir <parent>]`** scaffolds a complete Tailwind-first app (`app/` source, `app/app.js` entry) per [[DOC-SPEC]] §11. `default` is a minimal starter (Default layout, Home view, a Counter component demonstrating `setData` + arrow-function events); `todos` is the todos example app. Names are validated npm-safe; a non-empty target dir is refused.
- **`puzzle generate <component|view|layout|model> <Name> [--path <dir>] [--force]`** (alias `g`) stubs into `app/components|views|layouts|models`, locating the project root by walking up for `package.json`/`puzzle.config.js`. PascalCase names for `.pzl` types, lowercase for models.
- **`puzzle add tailwind`** writes the canonical `puzzle.config.js` + `app/styles/styles.css` when absent.
- **`puzzle add piece <name…>`** (amendment, 2026-07-17 — settled with Cory, superseding puzzle-pieces PLAN.md's "standalone npx CLI first" note): copies pieces from the puzzle-pieces registry (`compiler/internal/pieces`). Registry source = `--registry` flag → `PUZZLE_PIECES_REGISTRY` env → GitHub raw URL default, so it works pre-publish against a local checkout. Files copy VERBATIM (never stamped — copies stay diffable against the registry); `pieces.lock` records sha256 content hashes per piece (hashes, not version numbers: nothing to bump, and a future `diff`/`update` can tell upstream-changed from locally-customized). D3 holds: the npm install line is PRINTED, never executed. The registry THEME is treated as registry content: auto-copied verbatim to `app/styles/pieces.css` when the app has neither the tokens nor the file (locked with a hash like any piece, so a future update can track it); only the one-line `@import './pieces.css';` wiring stays a printed step, because styles.css is user-owned. Overwrite refusal is all-or-nothing (pre-flight lists every conflict before any write; an existing pieces.css is skipped, never a conflict).
- **`puzzle doctor [dir]`** runs ✓/✘/! environment checks (node on PATH, `app/app.js`, `index.html`, config load, Tailwind CLI resolution, runtime package presence) and exits 1 on any failure; **`puzzle info [dir]`** prints puzzle version, platform, node version, project root, source/output dirs, and the declared styles pipeline. `puzzle --version` is wired to `internal/version`.

Sub-decisions, each with its rejected alternative:

- **`init` is non-interactive — flags and defaults, never prompts.** Everything is a flag with a sensible default, to keep the CLI scriptable (CI, `npx` one-liners) and the surface small. (Rejected: interactive template/styling prompts — see Alternatives rejected.) **Amended 2026-07-16:** a bare `puzzle init` on a TTY now prompts for the missing app name (re-prompting through `scaffold.ValidateName` until valid); on a non-TTY (pipe/CI) zero args still hard-errors `app name required`, so scripts never hang. Options remain flags-only — the prompt covers exactly the one required positional, not template/styling choices, so the rejected-alternative rationale stands.
- **`add`/`generate` never rewrite user JavaScript ([[DECISION-D03-SCRIPTS-REAL-JS]]).** Model `generate` does **not** edit `app/models/index.js`; an existing `puzzle.config.js` is never rewritten by `add tailwind` (already-declared → no-op, otherwise the exact snippet + install line print as a manual step). The registration/config the author must add is **printed as an exact snippet** instead. (Rejected: auto-wiring by parsing/rewriting the user's JS — see Alternatives rejected.)
- **Templates are embedded real file trees, not strings built in Go.** Each template is a real directory under `compiler/internal/scaffold/templates/`, embedded via `go:embed` with `__APP_NAME__` substituted at write time. (Rejected: string-building the scaffolded files inside Go — see Alternatives rejected.)
- **Generated `.pzl` stubs are compile-checked against the repo's own compiler.** A test runs every generated `.pzl` through the repo's parser + codegen, so a grammar change that would break a stub breaks the test — the generators cannot drift from the language.
- **Each command self-registers from its own file.** `initcmd.go`/`generate.go`/`add.go`/`doctor.go`/`info.go` in `compiler/cmd/puzzle/` each register onto the root command; logic lives in `compiler/internal/scaffold` and `compiler/internal/generate`. `main.go` is untouched and no new Go dependencies were added.

## Alternatives rejected
- **Interactive prompts for `init`** (the old aspirational CLAUDE.md text promised template/styling prompts): rejected to keep the CLI scriptable (CI, `npx` one-liners) and the surface small.
- **Auto-wiring by parsing/rewriting the user's JS:** reintroduces exactly the JS-parsing the Go compiler refuses to own ([[DECISION-D03-SCRIPTS-REAL-JS]]).
- **String-building the scaffolded files inside Go:** rejected — real files stay diffable, editable, and testable as the app they produce.

## Consequences
**Caveat:** the scaffolded `package.json` pins `"@magic-spells/puzzle": "^0.1.0"`, and npm publish is still pending, so `npm install` in a fresh app only resolves once the runtime is published (or via a `file:`/manual install).

Non-breaking: `dev`/`build` are unchanged; this is an additive amendment (v1.4).
