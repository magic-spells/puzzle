---
name: Dev server & watcher
status: verified
verified_at: '2026-07-23T16:30:47.879Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEVSTATE
  - COMPONENT-COMPILER-CLI
  - FLOW-BUILD
  - FILE-DEV-SERVER
  - FILE-BUILD-WATCH
  - FILE-STYLES-WATCH
notes:
  - kind: gotcha
    text: >-
      The warm Tailwind child runs in its own process group and can survive the parent. Serve must
      synchronously stop it on every return path; relying only on the cancellation goroutine can
      orphan the process when the CLI exits immediately after an error.
verified_sha: 93ebefacfc0dcd35ea787a1f09b56aa308bea4f9
---

# Dev server (`puzzle dev`)

Runs the development build loop over the same plugin/build/style pipeline as production. It recursively watches `app/` (including new subdirectories), root/app public assets, and the config file; a 150ms debounce coalesces save bursts. Successful rebuilds update the incremental esbuild graph, formatter manifest, CSS, and mirrored public files. Failed rebuilds print positioned diagnostics and keep serving the last good output.

The HTTP server binds `127.0.0.1` synchronously before printing its ready banner. It serves `dist/` with SPA history fallback, injects the EventSource client only into the root index response, and leaves nested HTML untouched. `dev.proxy` prefixes register on the mux before the static catch-all, so proxied backend paths never reach the history fallback ([[FEATURE-DEV-PROXY]]). `/__puzzle/reload` uses buffered per-client channels and non-blocking broadcasts so a slow tab cannot stall a rebuild.

Before reload, the injected client invokes [[COMPONENT-DEVSTATE]]; the full page always reloads, with state restored best-effort by the new bundle. No per-module swap is attempted.

The terminal layer prints startup/build timing, changed paths, style status, and TTY-aware color. In a TTY, cbreak `q` exits while signals remain active. SIGINT/SIGTERM cancel watcher/SSE work and gracefully shut down HTTP. Testing caveat: `go run` does not forward SIGTERM to the child, so verify graceful shutdown against the built binary.

Tailwind uses one warm child process in its own process group; every Serve exit path synchronously reaps it. If the watcher cannot start or dies, the pipeline reports the fallback and uses one-shot composition. Config edits advise a restart because config loads once per dev process.
