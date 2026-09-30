---
name: >-
  D26 — Tailwind pipeline: config read by node, one-shot CLI per production build, one composition
  path
status: verified
verified_at: '2026-08-24T19:03:12.964Z'
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - FLOW-BUILD
  - DECISION-D12-TAILWIND-FIRST
  - DECISION-D03-SCRIPTS-REAL-JS
  - DECISION-D27-FAST-DEV-REBUILDS
code_refs:
  - compiler/cmd/puzzle/add.go
  - compiler/internal/build/build.go
  - compiler/internal/config/config.go
  - compiler/internal/dev/dev.go
  - compiler/internal/styles/resolve.go
  - compiler/internal/styles/styles.go
  - compiler/internal/styles/watch.go
  - compiler/internal/scaffold/templates/todos/package.json
  - compiler/internal/scaffold/templates/todos/puzzle.config.js
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D26 — Tailwind pipeline: node-read config, one-shot CLI per build, one composition path

How [[DECISION-D12-TAILWIND-FIRST]] is implemented. Dev's warm path is [[DECISION-D27-FAST-DEV-REBUILDS]].

## Decision
- **`puzzle.config.js` is executed by node, never parsed** ([[DECISION-D03-SCRIPTS-REAL-JS]]). `compiler/internal/config` runs `node --input-type=module -e` with a script that imports the config and prints its default export as JSON. The config path rides in `process.argv` and becomes a `file:` URL via node's `pathToFileURL` (so `#`, `%` and Windows drive letters work); the JSON follows a unique sentinel and Go reads only the text after its **last** occurrence, so a config that logs on import cannot corrupt the payload. No config file → zero-value defaults, no node run. Node missing → clear error. Malformed JS → node's syntax error. The config is loaded once per `Build()`.
- **CLI resolution** (`compiler/internal/styles`): Tailwind v4's `@tailwindcss/cli` first, then v3; if none runs, fail loudly with an install hint — never a silent empty stylesheet. v4 needs both `@tailwindcss/cli` and `tailwindcss` as devDependencies. Input is `app/styles/styles.css` when present; `--minify` in production.
- **`build.Build` owns the whole stylesheet.** It runs the CLI once and composes `dist/styles.css` = Tailwind layer + collected `<style>` blocks (Tailwind first). A declared-but-unrunnable pipeline fails the build.

## Gotcha
A failure report must never show only the first stderr line: Tailwind v4 opens stderr with its version banner, which hid the real error (e.g. `Can't resolve '@magic-spells/<pkg>/css'` from a dangling `file:` dependency). `NpxRunner.Run` reports each attempt's exec error plus the last 20 non-blank stderr lines. `RunOptions.CLIs` is a test-only seam.

## Alternatives rejected
- A `tailwind --watch` child driving `puzzle build` — a watcher can clobber the appended `<style>` layer and needs a watch on `dist/`; dev gets a warm child that writes to a private file instead (D27).
- Silently skipping an unrunnable pipeline — it fails the build and each dev rebuild.
