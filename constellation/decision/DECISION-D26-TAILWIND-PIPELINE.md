---
name: "D26 — Tailwind pipeline: node-read config, one-shot-per-build CLI, unified composition"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-COMPILER-CLI
  - COMPONENT-DEV-SERVER
  - FLOW-BUILD
  - DECISION-D12-TAILWIND-FIRST
---

# D26 — Tailwind pipeline: node-read config, one-shot-per-build CLI, unified composition

Settled (v1; Phase 3). Three sub-decisions on how `styles: { use: ['tailwindcss'] }` ([[DECISION-D12-TAILWIND-FIRST]]) is implemented: config read by executing node, CLI major auto-detection, and a single one-shot-per-build composition path shared by `build` and `dev`.

## Context
D12 chose Tailwind-first styling via `puzzle.config.js`'s `styles: { use: ['tailwindcss'] }`. Phase 3 had to implement how that config is read, which Tailwind CLI is invoked, and how the composed stylesheet is produced during both `build` and `dev`.

## Decision
Three sub-decisions:

- **Config read via node, not parsed ([[DECISION-D03-SCRIPTS-REAL-JS]]).** `puzzle.config.js` is loaded by executing `node --input-type=module -e "const m = await import(<file url>); console.log(JSON.stringify(m.default ?? {}))"` and unmarshaling the printed JSON (`compiler/internal/config`). No config file → zero-value defaults with **no** node invocation. Config present but node missing → clear error. Malformed JS → node's syntax error surfaced. `styles.use` accepts only the string `'tailwindcss'`; object entries (the deferred Sass shape) and any other string are parsed-and-rejected with a "not supported in v1" error that names the entry.
- **CLI major detection.** The runner (`compiler/internal/styles`) tries the modern v4 CLI first (`npx @tailwindcss/cli`) and falls back to v3 (`npx tailwindcss`); if neither runs it fails loudly with an install hint (never a silent empty stylesheet). v4 needs both `@tailwindcss/cli` (the binary) and `tailwindcss` (resolved by the input CSS's `@import "tailwindcss"`), so both are declared as devDependencies. Input CSS is `app/styles/styles.css` when present, else Tailwind's default. `--minify` is added for production.
- **One-shot per build in BOTH `build` and `dev`; no `--watch` child (deliberate deviation from the plan's suggestion, which permitted "document your choice").** `build.Build` owns the whole stylesheet: it runs the CLI once and composes `dist/styles.css` = Tailwind layer + collected `<styles>` blocks (Tailwind first). `puzzle dev` reuses that exact path per debounced rebuild rather than running a `tailwind --watch` child. Rationale: a single composition path avoids a watch process clobbering the appended `<styles>`, needs no watch on `dist/` (so no rebuild loop), and folds a Tailwind failure into dev's existing "print, keep serving, retry" loop. Every successful rebuild (Tailwind included) broadcasts one SSE reload. Cost — re-spawning the CLI per burst (~1s observed) — is acceptable for v1's full-page reload; a persistent `--watch` child is a future optimization. A declared-but-unrunnable pipeline **fails** the build (and each dev rebuild), per "never silently skip".

## Alternatives rejected
- **A `tailwind --watch` child process** (the plan's suggestion) — rejected in favor of one-shot per build so a single composition path avoids a watch process clobbering the appended `<styles>`, needs no watch on `dist/`, and folds Tailwind failures into dev's retry loop.
- **Object entries / other strings in `styles.use`** (the deferred Sass shape) — parsed-and-rejected with a "not supported in v1" error naming the entry.
- **Silently skipping a declared-but-unrunnable pipeline** — rejected; it fails the build and each dev rebuild.

## Consequences
The `dev` half of the one-shot bullet (one-shot per rebuild, no `--watch` child) is **amended by [[DECISION-D27-FAST-DEV-REBUILDS]]**: dev now runs a warm `--watch` child + esbuild incremental context for sub-200ms rebuilds. Production `build` keeps this one-shot path, now faster via direct CLI resolution.
