---
name: Dev server & watcher
status: verified
verified_at: '2026-07-25T05:24:00.566Z'
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
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

# Dev server (`puzzle dev`)

Runs the development build loop over the same plugin/build/style pipeline as production. It recursively watches `app/` (including new subdirectories), root/app public assets, and the config file; a 150ms debounce coalesces save bursts. Successful rebuilds update the incremental esbuild graph, formatter manifest, CSS, and mirrored public files. Failed rebuilds print positioned diagnostics and keep serving the last good output. Under `--fixtures` (D98) the watch builder's entry is the generated `.puzzle/fixtures/app.js` wrapper instead of `app/app.js` — generated once at builder construction and kept for the process lifetime; `.puzzle/` sits outside every watched directory by construction, so it can never feed a rebuild loop.

The HTTP server binds `127.0.0.1` synchronously before printing its ready banner. A busy port is not fatal: `listenDev` scans upward from `--port` for the first free one (bounded at 10 candidates) and the banner, browser-open, and `httpSrv.Addr` all read the port actually bound, with a warning line when it moved; `--strict-port` restores bind-or-fail ([[DECISION-D90-DEV-PORT-SCAN]]). It serves `dist/` with SPA history fallback, injects the EventSource client only into the root index response, and leaves nested HTML untouched. `dev.proxy` prefixes register on the mux before the static catch-all, so proxied backend paths never reach the history fallback ([[FEATURE-DEV-PROXY]]). `/__puzzle/reload` uses buffered per-client channels and non-blocking broadcasts so a slow tab cannot stall a rebuild.

Before reload, the injected client invokes [[COMPONENT-DEVSTATE]]; the full page always reloads, with state restored best-effort by the new bundle. No per-module swap is attempted.

The terminal layer prints startup/build timing, changed paths, style status, and TTY-aware color. In a TTY, cbreak `q` exits while signals remain active. SIGINT/SIGTERM cancel watcher/SSE work and gracefully shut down HTTP. Testing caveat: `go run` does not forward SIGTERM to the child, so verify graceful shutdown against the built binary.

Tailwind uses one warm child process in its own process group; every Serve exit path synchronously reaps it. If the watcher cannot start or dies, the pipeline reports the fallback and uses one-shot composition. Config edits advise a restart because config loads once per dev process.

A config file that fails to load is **not** fatal — dev keeps serving from the zero `Config` — but the warning has to name every key that loss drops, not just Tailwind. `dev.proxy` is the misleading one: with no proxy registered, the SPA history fallback answers `/api/*` with `index.html`, so the app reports a JSON parse error on `"<!doctype html>"` with nothing tying it back to the config. `configFallbackWarning` names both losses and says to restart. (`LoadConfig` returns no error when there is no config file at all, so a zero-config app never sees it.)
