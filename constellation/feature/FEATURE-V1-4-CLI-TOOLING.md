---
name: "v1.4 — CLI tooling surface"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D32-CLI-TOOLING
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
---

# v1.4 — CLI tooling surface

The full scaffolding/tooling CLI — `init`/`generate`/`add`/`doctor`/`info` (plus `--version`) — joins `dev`/`build`, completing what SPEC §11 promised. Driven by [[DECISION-D32-CLI-TOOLING]].

## Intent
D13 shipped v1's CLI as just `puzzle dev` + `puzzle build` and deferred the rest post-v1. Users had no scaffolding, code generation, or diagnostics — the SPEC §11 tooling surface was unfulfilled.

## Scope
**In:** `puzzle init <app-name> [--template default|todos] [--dir]` (non-interactive; embedded real file-tree templates via `go:embed` with `__APP_NAME__` substitution); `puzzle generate <component|view|layout|model> <Name>` (alias `g`, stubs compile-checked against the repo's own compiler); `puzzle add tailwind` (writes `puzzle.config.js` + `app/styles/styles.css` when absent); `puzzle doctor` (✓/✘/! environment checks, exit 1 on failure) and `puzzle info` (version/platform/node/paths/pipeline); `puzzle --version`. Each command self-registers from its own file; `main.go` untouched, no new Go deps.
**Out (rejected):** interactive prompts (rejected — CLI stays scriptable), and any rewriting of user JavaScript — `add`/`generate` never edit `app/models/index.js` or an existing config; they print the exact snippet instead (D3). All sub-decisions and the npm-publish caveat live in [[DECISION-D32-CLI-TOOLING]].

## Outcome
Shipped in v1.4; documented in [[DOC-SPEC]] §13. A CLI-only additive amendment — no compiler or runtime-kernel change; `dev`/`build` behave exactly as before. Touched [[COMPONENT-COMPILER-CLI]].
