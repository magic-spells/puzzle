---
name: "D26 — Tailwind pipeline: node-read config, one-shot-per-build CLI, unified composition"
status: verified
verified_at: '2026-08-24T19:03:12.964Z'
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - FLOW-BUILD
  - DECISION-D12-TAILWIND-FIRST
  - DECISION-D03-SCRIPTS-REAL-JS
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
notes:
  - kind: verified
    text: >-
      Config loading and the Tailwind build/dev split re-truthed against config.go and
      styles/watch.go.
    sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D26 — Tailwind pipeline: node-read config, one-shot-per-build CLI, unified composition

Settled (v1; Phase 3). Three sub-decisions on how `styles: { use: ['tailwindcss'] }` ([[DECISION-D12-TAILWIND-FIRST]]) is implemented: config read by executing node, CLI major auto-detection, and a single one-shot composition path owned by `build.Build`.

## Context
D12 chose Tailwind-first styling via `puzzle.config.js`'s `styles: { use: ['tailwindcss'] }`. Phase 3 had to implement how that config is read, which Tailwind CLI is invoked, and how the composed stylesheet is produced during both `build` and `dev`.

## Decision

Three sub-decisions:

- **Config read via node, not parsed ([[DECISION-D03-SCRIPTS-REAL-JS]]).** `puzzle.config.js` is loaded by executing `node --input-type=module -e` with a script that `await import`s the config and writes its default export as JSON to stdout (`compiler/internal/config`). The absolute config path rides in `process.argv` and is turned into a `file:` URL by node's own `pathToFileURL`, so a path containing `#`, `%`, or a Windows drive letter resolves correctly; the JSON is prefixed with a unique sentinel and Go reads only the text after the sentinel's LAST occurrence, so a config that logs on import cannot corrupt the payload. No config file → zero-value defaults with **no** node invocation. Config present but node missing → clear error. Malformed JS → node's syntax error surfaced. `styles.use` accepts only the string `'tailwindcss'`; object entries (the deferred Sass shape) and any other string are parsed-and-rejected with a "not supported in v1" error that names the entry.
- **CLI major detection.** The runner (`compiler/internal/styles`) tries the modern v4 CLI first (`npx @tailwindcss/cli`) and falls back to v3 (`npx tailwindcss`); if neither runs it fails loudly with an install hint (never a silent empty stylesheet). v4 needs both `@tailwindcss/cli` (the binary) and `tailwindcss` (resolved by the input CSS's `@import "tailwindcss"`), so both are declared as devDependencies. Input CSS is `app/styles/styles.css` when present, else Tailwind's default. `--minify` is added for production.
- **One-shot per build in `puzzle build`; no `--watch` child (deliberate deviation from the plan's suggestion, which permitted "document your choice").** `build.Build` owns the whole stylesheet: it runs the CLI once and composes `dist/styles.css` = Tailwind layer + collected `<style>` blocks (Tailwind first). Rationale: a single composition path avoids a watch process clobbering the appended `<style>`, needs no watch on `dist/` (so no rebuild loop), and folds a Tailwind failure into the caller's existing error reporting. Cost — re-spawning the CLI per build (~1s observed) — is acceptable for a one-shot command; the live-reload loop gets a warm `--watch` child instead ([[DECISION-D27-FAST-DEV-REBUILDS]]), and every successful dev rebuild (Tailwind included) broadcasts one SSE reload. A declared-but-unrunnable pipeline **fails** the build (and each dev rebuild), per "never silently skip".

## Alternatives rejected
- **A `tailwind --watch` child driving `puzzle build`** (the plan's suggestion) — rejected in favor of one-shot composition: a single path avoids a watch process clobbering the appended `<style>` and needs no watch on `dist/`. Dev pays neither cost because D27's warm child writes to a private file the compose step reads.
- **Object entries / other strings in `styles.use`** (the deferred Sass shape) — parsed-and-rejected with a "not supported in v1" error naming the entry.
- **Silently skipping a declared-but-unrunnable pipeline** — rejected; it fails the build and each dev rebuild.

## Consequences
Dev's rebuild loop is [[DECISION-D27-FAST-DEV-REBUILDS]]'s: a warm `--watch` child plus an esbuild incremental context for sub-200ms rebuilds, degrading to this one-shot path whenever the warm child cannot run or dies mid-session. Production `build` keeps the one-shot path, made faster by D27's direct CLI resolution.
