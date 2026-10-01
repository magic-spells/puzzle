---
name: Dev server & watcher
status: verified
verified_at: '2026-08-24T21:11:50.859Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEVSTATE
  - COMPONENT-COMPILER-CLI
  - FLOW-BUILD
  - FILE-DEV-SERVER
  - FILE-BUILD-WATCH
  - FILE-STYLES-WATCH
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: gotcha
    text: >-
      Serve spells the app root as the disk stores it (fsutil.CanonicalCase) right after
      filepath.Abs, before any path is derived. On a case-insensitive volume (macOS APFS) a server
      started from ~/code/app when the folder is Code otherwise hands the `tailwindcss --watch`
      child lowercase paths while its file events arrive in the real case, so edits to an @imported
      stylesheet never rebuild. filepath.EvalSymlinks does not fix this on macOS (it keeps the
      caller's spelling), and symlinks are deliberately left unresolved: a symlinked root already
      works because Tailwind's watcher resolves it.
---

# Dev server (`puzzle dev`)

`compiler/internal/dev` plus the watch builders in `internal/build` (`WatchBuilder` for
SPA/hybrid, `StaticWatchBuilder` for static). Same plugin/build/style pipeline as
production. The end-to-end rebuild sequence is [[FLOW-DEV-REBUILD]].

## Startup

Resolve the app root → `build.PreflightRuntime` (once; errors go up through Serve to
one stderr line + exit 1) → `build.SweepWorkDirs` (the SPA path never calls
`build.Build`, so it must sweep itself) → watchers → listener. The config loaded here is
handed to every `build.Build` of the session (`build.Options.Config`), so rebuilds never
re-spawn node to read it and see exactly the config dev uses. A config that FAILS to load
is non-fatal: dev serves from the zero `Config`, and `configFallbackWarning` names every
lost key — notably `dev.proxy`, whose loss makes the SPA fallback answer `/api/*` with
`index.html`. Config edits advise a restart.

## Watching and change filtering

Recursive watches on `app/` (new subdirs included) and root/app `public/`, plus a
non-recursive config watch that drops everything but `puzzle.config.js` — so
`.puzzle/` (the `--fixtures` wrapper, `tmp/`) can never feed a rebuild loop. A 150 ms
debounce coalesces bursts.

- **Junk denylist** (not an extension allowlist, since `public/` legitimately ships
  `.htaccess`, `_headers`, `.well-known/*`): `.DS_Store`, `Thumbs.db`, `desktop.ini`,
  vim's `4913` and swap-SHAPED files (`Home.pzl.swp`, not `player.swf`), `*~`, emacs
  locks/autosaves, JetBrains `___jb_tmp___`. A pure-junk burst rebuilds nothing.
- **Echo filter** (`dev/changes.go`): `onChange` runs synchronously, so a save's trailing
  metadata event lands in a fresh debounce window and would rebuild twice. Inside a 2 s
  echo window that only a SUCCESSFUL rebuild opens, a burst whose BYTES didn't change
  schedules nothing. Outside it every event rebuilds; a failed rebuild closes the window
  and clears the memo. Suppression always expires — no event is swallowed without a
  recovery path. (Widening the debounce can't fix this; the gap scales with rebuild time.)

## SPA loop

Successful rebuilds update the incremental esbuild graph, formatter manifest, CSS and
mirrored public files; failures print positioned diagnostics and keep serving the last
good output. Under `--fixtures` (D98) the entry is the generated `.puzzle/fixtures/app.js`
wrapper for the process lifetime. `hybrid` uses this loop (it IS the SPA after takeover).

D156 ([[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]]): the constructor's usage scan serves
startup; later scans need a `.pzl` change; the full public mirror needs an initial batch,
a public-path batch, or a changed resolved public source; a public-only batch skips
esbuild unless that asset was in the prior module graph (symlink-normalized). Living
under `public/` is never proof a file is an asset.

**Locales** (D175): the first build and any batch touching `app/locales/**` reload the
set (a bad file fails the rebuild, keeping last-good dist and manifest), write new hashed
files into `dist/locales/` without overwriting, refresh the manifest, rebuild `app.js`
and reload; superseded files are pruned only after success. **A failed load is
remembered** (`localesFailed`) and retried on every later rebuild — otherwise an
unrelated save lands on last-good tables and clears the overlay while the file is still
broken. A superseded never-landed load's files are deleted (`dropNextLocales`) unless
the committed or new set names them. `ValidatePublic` reserves `locales/` when i18n is on.

## Static loop

An `output: 'static'` project runs the real pipeline
([[DECISION-D148-PREVIEW-AND-STATIC-DEV]]) through `StaticWatchBuilder`
([[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]): three persistent esbuild contexts plus the
warm Tailwind child, composed into fresh staging and atomically swapped, so a failed
compile or prerender keeps the last good pages. If construction fails it degrades to a
one-shot `build.Build` per save (identical output). `--fixtures` + static is rejected at
startup.

**Route-level invalidation** ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]): the batch is
classified against a reverse dependency graph from the previous rebuild's two metafiles
(per-page pass → routes whose chain contains a file; prerender bundle → render-wide
inputs like `app/app.js`, `routes.js`, the models registry, formatters) plus the compile
cache's `{#svg}` edge. The prerender runs with an `argv[4]` route filter; unrendered
pages are hardlinked from the served tree into staging. Anything unplaceable — and any
partial that can't complete — is a full render inside the same `Rebuild`; a compile error
is NOT a fallback trigger. A locale file is render-wide (read from disk, never imported).
A public path the committed graph knows is classified as that module; only a path in
neither graph set is a zero-route copy. **Change paths stay pending until a rebuild
LANDS** — graph and pending set commit only after the swap, so failures keep every path
queued. Locale failure-memory comes from testing the accumulated `pending` batch.

## Styles (both loops)

One warm Tailwind child in its own process group. **Every Serve return path must
synchronously stop it** — relying on the cancellation goroutine orphans it when the CLI
exits right after an error. Static mode waits (bounded) for the child's first output
before the initial build (it bakes CSS into every page); SPA mode doesn't (the poll
recomposes in place; poll/death-watch goroutines start only after the callback is set).
The output poll drives a styles-only recompose: in place for SPA, via
`StaticWatchBuilder.RecomposeStyles` (swap `dist/styles.css` alone, zero routes, reload
only if bytes changed) for static. `pipeline.recompose` skips a write whose bytes match
the last write — only while the served file still exists, so an external delete heals.
Callbacks never see working CSS from a failed esbuild pass; a failed write leaves the memo
unarmed. If the watcher can't start, one-shot composition is the fallback.

## HTTP and reload

Binds `127.0.0.1` before printing the banner; a busy port scans up to 10 candidates
(`serve.Listen`, shared with `preview`; `--strict-port` = bind-or-fail,
[[DECISION-D90-DEV-PORT-SCAN]]), and banner/browser-open read the bound port. URL →
file mapping is the shared mode-aware `serve.Resolve`, so dev and preview can't drift:
SPA keeps history fallback and injects the reload client only into the root index;
static resolves clean URLs, answers real 404s, and injects the client into EVERY HTML
response at serve time (disk stays clean). `dev.proxy` prefixes register before the
catch-all. `/__puzzle/reload` uses buffered per-client channels and non-blocking
broadcasts. Before reloading, the client invokes [[COMPONENT-DEVSTATE]]; the page always
fully reloads.

**Nothing served from `dist/` is cached.** Every response the dev server builds or
serves from `dist/` (HTML pages, the shell, the 404 and build-error pages, and
`http.ServeFile` assets such as `app.js`) sends `Cache-Control: no-store`
(`devCacheControl`). `http.ServeFile` validates with a one-second `Last-Modified`, so
a cached `app.js` could revalidate as 304 after two rebuilds inside one second and the
reload would run the older bundle. The SSE stream keeps `no-cache`; proxied responses
keep the backend's headers.

**One stream per origin.** A browser allows six HTTP/1.1 connections per host, so a
stream per tab starved the host once about six dev tabs were open (every further
request, a reload's own document included, sat pending). The client elects one tab
with the Web Locks API (`puzzle-dev-reload`; lock and channel names are origin-scoped,
and the origin carries the port) to hold the only EventSource and relay every hub event
over a BroadcastChannel; each tab still draws its own overlay and runs its own
snapshot-then-reload. A tab joining while a build is broken asks the leader for the
retained error (`hello`), since the server's replay reaches only a new stream. A page
reloading or hiding (`pagehide`) closes its stream and releases the lock first;
`pageshow` with `persisted` rejoins. No `navigator.locks` (an insecure origin, e.g. a
LAN IP) or no BroadcastChannel means a direct stream per tab, as before.
`tests-browser/dev-reload.spec.js` drives eight tabs through edits, a leader close and a
build error on its own temp app.

Known gap: the hub replays only the retained build error, never a `reload`. A rebuild
that lands while the leader is closing and the next tab is still connecting (lock
handoff plus one localhost connect) reaches no tab; the next edit reloads them.

Terminal: timing, changed paths, TTY color; cbreak `q` quits (`internal/keys`, shared
with preview); SIGINT/SIGTERM shut down gracefully. `go run` doesn't forward SIGTERM —
test shutdown against the built binary. `--profile-build` prints stderr phase tables in
every mode.
