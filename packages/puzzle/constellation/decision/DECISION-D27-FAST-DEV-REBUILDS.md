---
name: "D27 — Fast dev rebuilds: direct CLI resolution + warm Tailwind watcher + esbuild incremental context (amends D26)"
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
notes:
  - kind: verified
    text: >-
      Dev fallback behavior and the rebuild timing label re-truthed against dev.go and
      watch_static.go.
    sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D27 — Fast dev rebuilds: direct CLI resolution + warm Tailwind watcher + esbuild incremental context (amends D26)

Settled (v1; Phase 3 optimization). Amends [[DECISION-D26-TAILWIND-PIPELINE]]: keeps D26's one-shot model for production `puzzle build` but replaces the dev path with direct CLI resolution, a warm `tailwindcss --watch` child, and an esbuild incremental context — dropping warm dev rebuilds from ~300–800ms to ~10–15ms.

## Context
D26 chose "one-shot per rebuild, no `--watch` child" for simplicity, accepting the CLI re-spawn cost (~1s observed; ~1.4s on a user's machine — measured to be ~95% `npx` resolution + Node cold start + Tailwind boot, with the actual `.pzl` parse+codegen at 0.26ms/file and the esbuild bundle ~20ms). That cost is unacceptable for a live-reload loop. D27 keeps D26's model for **production `puzzle build`** but replaces the dev path with three changes.

## Decision
- **Direct CLI resolution (helps BOTH `build` and `dev`).** Before falling back to `npx`, `internal/styles` resolves the Tailwind CLI from `node_modules`, walking up from the app root: Tailwind v4's `@tailwindcss/cli` (reading its `package.json` `"bin"` and running `node <that script>`) then v3's `node_modules/.bin/tailwindcss`. The two `npx` invocations (`@tailwindcss/cli`, `tailwindcss`) remain as portable fallbacks. Measured: `npx @tailwindcss/cli` one-shot ≈ 780ms vs direct `node <cli>` ≈ 330ms — the direct path removes ~450ms of `npx` overhead per invocation, so even `puzzle build` gets faster.
- **Warm `tailwindcss --watch` child in `dev`.** When `puzzle.config.js` declares Tailwind, `puzzle dev` starts the resolved CLI with `--watch -i <input> -o <private file>` **once** at startup (an `os.CreateTemp` CSS file, never under `dist/`, so it is never served; removed on shutdown). `dist/styles.css` is re-composed (Tailwind layer + collected `<style>`) whenever **either** side changes: (a) the child rewrites its output — an mtime poll of that one file (simplest reliable trigger; single-file fsnotify is fragile across atomic replaces) recomposes + reloads; (b) an esbuild rebuild changes the collected `<style>` — recompose on that path. A single `.pzl` edit fires both, so reload broadcasts are **coalesced** within 100ms into one full-page reload. The child is killed on shutdown via the existing context: it runs in its own process group (`Setpgid` on unix via build-tagged `proc_unix.go`/`proc_other.go`) and is `SIGKILL`ed as a group (negative pid) so `node` dies with us; non-unix kills the process directly. **Gotcha (found in the manual proof):** the Tailwind v4 `--watch` CLI exits on stdin EOF, so a detached child inheriting `/dev/null` terminates right after its first build — the watcher holds a stdin pipe open for the child's lifetime to prevent this.
- **esbuild incremental context in `dev`.** `internal/build` exposes `NewWatchBuilder(root) → { Rebuild(); CSS(); Dispose() }` backed by `api.Context`, so rebuilds reuse esbuild's caches (only changed inputs re-read). `build.Build` is unchanged for production. The `.pzl` plugin's `<style>` collector — now shared across incremental rebuilds via one persistent `Plugin` — was made reset-correct: `onLoad` set-or-**deletes** by `<style>` presence (a file edited to drop its block loses its entry), and `CSS()` prunes entries whose file no longer exists (a deleted `.pzl`, whose `onLoad` never re-runs).

## Consequences

**Fallback behavior (never leave dev without CSS updates):** if the incremental context can't be created, dev warns and degrades to the D26 one-shot path — a full `build.Build` per change, slower but producing identical output, running Tailwind itself. If the warm child can't start, or **dies unexpectedly** mid-session, dev logs it and composes with a one-shot Tailwind run for the rest of the session. An unreadable `puzzle.config.js` does not stop dev either: it prints one warning and keeps going with zero-value defaults — no Tailwind pipeline and no `dev.proxy`, but still the incremental builder — advising a restart once the config is fixed.

**"rebuilt in Xms" stays honest**, and what it covers follows the serving mode: on the SPA path, the incremental esbuild rebuild plus the compose; on the static path, the whole staged rebuild that mode requires (app bundle, compose, prerender bundle + node render, per-page bundles — [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]). The Tailwind CLI is off both paths while the warm child is alive; the watcher's readiness is logged once at startup.

**Measured (examples/todos, this environment):** warm dev rebuilds dropped from ~300–800ms (one-shot Tailwind per rebuild) to **~10–15ms** (esbuild incremental + compose), comfortably under the 200ms target.
