---
name: Dev server & watcher
status: verified
verified_at: '2026-11-01T19:26:04.240Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEVSTATE
  - COMPONENT-COMPILER-CLI
  - FLOW-DEV-REBUILD
  - FILE-DEV-SERVER
  - FILE-BUILD-WATCH
  - FILE-STYLES-WATCH
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D156-BUILD-PIPELINE-PERFORMANCE
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Dev server (`puzzle dev`)

`compiler/internal/dev` plus the watch builders in `internal/build` (`WatchBuilder` for
SPA/hybrid, `StaticWatchBuilder` for static). Same plugin/build/style pipeline as
production. The ordered rebuild sequence and its ordering constraints are
[[FLOW-DEV-REBUILD]]; the user contract is [[DOC-SPEC-BUILD]] §13, §27, §36 (dev serving)
and §50. This card holds the component's responsibilities and gotchas.

## Startup

Resolve the app root, then spell it as the disk stores it (`fsutil.CanonicalCase`) before
any path is derived. On a case-insensitive volume a server started from `~/code/app` when
the folder is `Code` would otherwise hand the `tailwindcss --watch` child lowercase paths
while its file events arrive in the real case, so edits to an `@import`ed stylesheet never
rebuild. `filepath.EvalSymlinks` does not fix this on macOS (it keeps the caller's
spelling); symlinks are deliberately left unresolved, since Tailwind's watcher resolves
them.

Then `build.PreflightRuntime` (once; errors go up through Serve to one stderr line +
exit 1) → `build.SweepWorkDirs` (the SPA path never calls `build.Build`, so it must sweep
itself) → watchers → listener. The config loaded here is handed to every `build.Build` of
the session (`build.Options.Config`), so rebuilds never re-spawn node to read it. A config
that FAILS to load is non-fatal: dev serves from the zero `Config`, and
`configFallbackWarning` names every lost key — notably `dev.proxy`, whose loss makes the
SPA fallback answer `/api/*` with `index.html`. Config edits advise a restart.

## Watching and change filtering

Recursive watches on `app/` (new subdirs included) and root/app `public/`, plus a
non-recursive root watch that drops everything but `puzzle.config.js` — so `.puzzle/`
(the `--fixtures` wrapper, `tmp/`) can never feed a rebuild loop. A 150 ms debounce
coalesces bursts.

- **Junk denylist** (not an extension allowlist, since `public/` legitimately ships
  `.htaccess`, `_headers`, `.well-known/*`): `.DS_Store`, `Thumbs.db`, `desktop.ini`, vim's
  `4913` and swap-SHAPED files (`Home.pzl.swp`, not `player.swf`), `*~`, emacs
  locks/autosaves, JetBrains `___jb_tmp___`/`___jb_old___`. A pure-junk burst rebuilds
  nothing.
- **Echo filter** (`dev/changes.go`): `onChange` runs synchronously, so a save's trailing
  metadata event lands in a fresh debounce window and would rebuild twice. Inside a 2 s
  echo window that only a SUCCESSFUL rebuild opens, a burst whose BYTES didn't change
  schedules nothing. A failed rebuild closes the window and clears the memo. Suppression
  always expires — no event is swallowed without a recovery path. (Widening the debounce
  can't fix this; the gap scales with rebuild time.)

## SPA loop

`hybrid` uses this loop too (it IS the SPA after takeover). Under `--fixtures` (D98) the
entry is the generated `.puzzle/fixtures/` wrapper for the process lifetime. Batch
classification ([[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]]): the constructor's usage
scan serves startup; later scans need a scan input; the full public mirror needs an
initial batch, a public-path batch, or a changed resolved public source; a public-only
batch skips esbuild unless that asset was in the prior module graph (symlink-normalized).
Living under `public/` is never proof a file is an asset.

**Locales** (D175, in `WatchBuilder`): the first build and any batch touching
`app/locales/**` reload the set (a bad file fails the rebuild, keeping last-good dist and
manifest), write new hashed files into `dist/locales/` without overwriting, refresh the
manifest, rebuild and reload; superseded files are pruned only after success. **A failed
load is remembered** (`localesFailed`) and retried on every later rebuild — otherwise an
unrelated save lands on last-good tables and clears the overlay while the file is still
broken. A superseded never-landed load's files are deleted (`dropNextLocales`) unless the
committed or new set names them.

## Static loop

`StaticWatchBuilder` ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]],
[[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]): three persistent esbuild contexts (app pass,
node prerender bundle, multi-entry page pass), the warm Tailwind child, a session compile
memo and an incremental usage scan, composed into fresh staging and atomically swapped.
If construction fails it degrades to a one-shot `build.Build` per save (identical
output). Nothing writes into served `dist/` out-of-band; a Tailwind rewrite drives a
debounced styles-only rebuild.

**Route-level invalidation** ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]): the batch is
classified against a reverse dependency graph from the previous rebuild's two metafiles
(per-page pass → routes whose chain contains a file; prerender bundle → render-wide inputs
like `app/app.js`, `routes.js`, the models registry, formatters) plus the compile cache's
`{#svg}` edge. The prerender runs with an `argv[4]` route filter; unrendered pages are
hardlinked from the served tree into staging. Anything unplaceable — and any partial that
can't complete — is a full render inside the same `Rebuild`; a compile error is NOT a
fallback trigger. A locale file is render-wide (read from disk, never imported). A public
path the committed graph knows is classified as that module; only a path in neither graph
set is a zero-route copy. Locale failure memory tests the accumulated `pending` batch.

## Styles (both loops)

One warm Tailwind child in its own process group. **Every Serve return path must
synchronously stop it** — relying on the cancellation goroutine orphans it when the CLI
exits right after an error. SPA mode does not wait for its first output (the poll
recomposes in place; poll/death-watch goroutines start only after the callback is set).
The output poll drives a styles-only recompose: in place for SPA, via
`StaticWatchBuilder.RecomposeStyles` (swap the stylesheet alone, zero routes, reload only
if bytes changed) for static. `pipeline.recompose` skips a write whose bytes match the last
write — only while the served file still exists, so an external delete heals. A failed
write leaves the memo unarmed. If the watcher can't start, one-shot composition is the
fallback.

## HTTP and reload

Binds per `--host` (loopback by default) before printing the banner; a busy port scans up
to 10 candidates (`serve.ListenHost`, shared with `preview`; `--strict-port` =
bind-or-fail, [[DECISION-D90-DEV-PORT-SCAN]]); banner and browser-open read the bound
port. URL → file mapping is the shared mode-aware `serve.Resolve`, so dev and preview
can't drift: SPA keeps history fallback and injects the reload client only into the root
index; static resolves clean URLs, answers real 404s (per-locale
`dist/<first-segment>/404.html` first, exact case, read from the file layout not the
config — [[DECISION-D177-LOCALE-URL-PREFIXES]]), and injects the client into EVERY HTML
response at serve time. `dev.proxy` prefixes register before the catch-all.
`/__puzzle/reload` uses buffered per-client channels and non-blocking broadcasts. Before
reloading, the client invokes [[COMPONENT-DEVSTATE]]; the page always fully reloads.

**Nothing served from `dist/` is cached.** Every response built or served from `dist/`
sends `Cache-Control: no-store` (`devCacheControl`). `http.ServeFile` validates with a
one-second `Last-Modified`, so a cached `app.js` could revalidate as 304 after two rebuilds
inside one second and the reload would run the older bundle. The SSE stream keeps
`no-cache`; proxied responses keep the backend's headers.

**One stream per origin.** A browser allows six HTTP/1.1 connections per host, so a stream
per tab starves the host once about six dev tabs are open. The client elects one tab with
the Web Locks API (`puzzle-dev-reload`; names are origin-scoped, and the origin carries
the port) to hold the only EventSource and relay every hub event over a BroadcastChannel;
each tab still draws its own overlay and runs its own snapshot-then-reload. A tab joining
while a build is broken asks the leader for the retained error (`hello`), since the
server's replay reaches only a new stream. `pagehide` closes the stream and releases the
lock first; `pageshow` with `persisted` rejoins. No `navigator.locks` (an insecure origin,
e.g. a LAN IP) or no BroadcastChannel means a direct stream per tab.
`tests-browser/dev-reload.spec.js` drives eight tabs through edits, a leader close and a
build error.

Known gap: the hub replays only the retained build error, never a `reload`. A rebuild that
lands while the leader is closing and the next tab is still connecting reaches no tab; the
next edit reloads them.

Terminal: timing, changed paths, TTY color; cbreak `q` quits (`internal/keys`, shared with
preview); SIGINT/SIGTERM shut down gracefully. `go run` doesn't forward SIGTERM — test
shutdown against the built binary.
