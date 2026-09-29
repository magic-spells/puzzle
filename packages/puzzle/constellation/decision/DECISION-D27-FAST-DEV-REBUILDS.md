---
name: >-
  D27 — Fast dev rebuilds: direct CLI resolution, a warm Tailwind watcher, an esbuild incremental
  context
status: verified
verified_at: '2026-08-24T19:03:17.385Z'
connections:
  - COMPONENT-DEV-SERVER
  - COMPONENT-ESBUILD-PLUGIN
  - FLOW-BUILD
  - DECISION-D26-TAILWIND-PIPELINE
code_refs:
  - compiler/internal/build/watch.go
  - compiler/internal/build/watch_static.go
  - compiler/internal/dev/dev.go
  - compiler/internal/plugin/plugin.go
  - compiler/internal/styles/proc_other.go
  - compiler/internal/styles/proc_unix.go
  - compiler/internal/styles/resolve.go
  - compiler/internal/styles/styles.go
  - compiler/internal/styles/watch.go
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D27 — Fast dev rebuilds: direct CLI resolution, warm Tailwind watcher, esbuild incremental context

Production `puzzle build` keeps [[DECISION-D26-TAILWIND-PIPELINE]]'s one-shot path; dev replaces it. Warm dev rebuilds run ~10–15 ms on examples/todos (target: under 200 ms). Almost all of the old ~1 s cost was `npx` resolution, Node cold start and Tailwind boot, not `.pzl` compilation.

## Decision
- **Direct CLI resolution (build and dev).** Before `npx`, `internal/styles` resolves the Tailwind CLI from `node_modules`, walking up from the app root: v4's `@tailwindcss/cli` `"bin"` script run as `node <script>`, then v3's `node_modules/.bin/tailwindcss`. The `npx` forms stay as portable fallbacks.
- **A warm `tailwindcss --watch` child in dev**, started once with `-i <input> -o <private temp file>` (never under `dist/`, removed on shutdown). `dist/styles.css` is recomposed when either side changes: an mtime poll of the child's output file, or an esbuild rebuild that changes the collected `<style>`. One `.pzl` edit fires both, so reload broadcasts coalesce within 100 ms into one reload.
  - The child runs in its own process group (`Setpgid`, `proc_unix.go`) and is killed as a group so `node` dies with dev; non-unix kills the process directly.
  - **Gotcha:** the v4 `--watch` CLI exits on stdin EOF, so the watcher holds a stdin pipe open for the child's lifetime.
- **An esbuild incremental context in dev.** `build.NewWatchBuilder(root)` (`Rebuild`/`CSS`/`Dispose`) wraps `api.Context`. The plugin's `<style>` collector is shared across rebuilds and stays reset-correct: `onLoad` sets **or deletes** a file's entry by `<style>` presence, and `CSS()` prunes entries for deleted files.

## Fallbacks (dev never loses CSS updates)
- No incremental context → warn and run a full `build.Build` per change.
- Warm child fails to start or dies → log it and compose with one-shot Tailwind runs for the rest of the session.
- Unreadable `puzzle.config.js` → one warning, zero-value defaults (no Tailwind, no `dev.proxy`), advise a restart.

"rebuilt in Xms" covers what the serving mode rebuilds: the incremental esbuild rebuild plus compose on the SPA path; the whole staged rebuild on the static path ([[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]).
