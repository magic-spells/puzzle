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

Runs the development build loop over the same plugin/build/style pipeline as production. It recursively watches `app/` (including new subdirectories), root/app public assets, and the config file; a 150ms debounce coalesces save bursts. Known editor/OS scratch files — `.DS_Store`, `Thumbs.db`, `desktop.ini`, vim's `4913` probe and `*.sw?` swaps, `*~` backups, emacs `.#lock`/`#autosave#`, JetBrains `___jb_tmp___` — are dropped from a burst before it schedules anything, so a burst of pure junk rebuilds nothing. It is a denylist of specific names, deliberately not an extension allowlist: `public/` legitimately ships `.htaccess`, `_headers`, `_redirects`, `.nojekyll`, and `.well-known/*`, so anything unrecognized must still rebuild. Successful rebuilds update the incremental esbuild graph, formatter manifest, CSS, and mirrored public files. Failed rebuilds print positioned diagnostics and keep serving the last good output. Under `--fixtures` (D98) the watch builder's entry is the generated `.puzzle/fixtures/app.js` wrapper instead of `app/app.js` — generated once at builder construction and kept for the process lifetime; `.puzzle/` sits outside every watched directory by construction, so it can never feed a rebuild loop.

An `output: 'static'` project gets the REAL pipeline instead ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]]): the incremental WatchBuilder and warm Tailwind child are never started, and every rebuild runs the full one-shot `build.Build` (development define, static output) — prerender pass, per-page modules, staging dir and atomic swap, so a failed compile OR prerender keeps the last good pages serving. `--fixtures` + static config is rejected at startup. `hybrid` stays on the SPA loop (it IS the SPA after takeover).

The HTTP server binds `127.0.0.1` synchronously before printing its ready banner. A busy port is not fatal: `serve.Listen` (the D90 scan, shared with `puzzle preview` via `internal/serve`) scans upward from `--port` for the first free one (bounded at 10 candidates) and the banner, browser-open, and `httpSrv.Addr` all read the port actually bound, with a warning line when it moved; `--strict-port` restores bind-or-fail ([[DECISION-D90-DEV-PORT-SCAN]]). URL→file mapping goes through the same package's mode-aware `serve.Resolve`, so dev and preview cannot drift: SPA mode keeps history fallback, injects the EventSource client only into the root index response, and leaves nested HTML untouched; static mode resolves clean URLs, answers real 404s (the built `404.html`, else a minimal dev page), and injects the client at serve time into EVERY HTML page it writes — disk stays production-clean, and reload plus the D92 overlay reach static pages through the normal SSE channel. `dev.proxy` prefixes register on the mux before the static catch-all, so proxied backend paths never reach the history fallback ([[FEATURE-DEV-PROXY]]). `/__puzzle/reload` uses buffered per-client channels and non-blocking broadcasts so a slow tab cannot stall a rebuild.

Before reload, the injected client invokes [[COMPONENT-DEVSTATE]]; the full page always reloads, with state restored best-effort by the new bundle. No per-module swap is attempted.

The terminal layer prints startup/build timing, changed paths, style status, and TTY-aware color. In a TTY, cbreak `q` exits while signals remain active. SIGINT/SIGTERM cancel watcher/SSE work and gracefully shut down HTTP. Testing caveat: `go run` does not forward SIGTERM to the child, so verify graceful shutdown against the built binary.

The config Serve loads at startup is handed to every `build.Build` the session runs (`build.Options.Config`), so a rebuild never re-spawns `node -e` to re-read a file dev has already decided not to reload — and the builds see exactly the config the rest of the loop uses, closing the gap where a static rebuild silently picked up a mid-session config edit that dev itself was ignoring. A config that FAILED to load is not passed along: dev degrades to the zero `Config` for its own decisions, while a build keeps its own hard failure on a malformed config file.

Tailwind uses one warm child process in its own process group; every Serve exit path synchronously reaps it. If the watcher cannot start or dies, the pipeline reports the fallback and uses one-shot composition. Config edits advise a restart because config loads once per dev process.

A config file that fails to load is **not** fatal — dev keeps serving from the zero `Config` — but the warning has to name every key that loss drops, not just Tailwind. `dev.proxy` is the misleading one: with no proxy registered, the SPA history fallback answers `/api/*` with `index.html`, so the app reports a JSON parse error on `"<!doctype html>"` with nothing tying it back to the config. `configFallbackWarning` names both losses and says to restart. (`LoadConfig` returns no error when there is no config file at all, so a zero-config app never sees it.)
