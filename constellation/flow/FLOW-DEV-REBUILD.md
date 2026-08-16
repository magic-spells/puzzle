---
name: Dev rebuild loop
status: built
triggers:
  - kind: manual
connections:
  - COMPONENT-DEV-SERVER
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEVSTATE
  - COMPONENT-SSG
  - FILE-DEV-SERVER
  - FILE-BUILD-WATCH
  - FILE-STYLES-WATCH
  - FILE-DEVSTATE
  - DECISION-D13-CLI-DEV-BUILD
  - DECISION-D27-FAST-DEV-REBUILDS
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D90-DEV-PORT-SCAN
  - DECISION-D92-DEV-ERROR-OVERLAY
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - DECISION-D153-PUZZLE-SCRATCH-DIR
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D156-BUILD-PIPELINE-PERFORMANCE
  - FEATURE-HMR
  - FEATURE-BUILD-PIPELINE-PERFORMANCE-HARDENING
  - FLOW-BUILD
  - FLOW-PRERENDER
  - DOC-SPEC-BUILD
  - DOC-DEVELOPMENT
---


# Dev rebuild loop

[[FLOW-BUILD]] describes the compiler pipeline `puzzle build` and `puzzle dev`
share. This card is the loop wrapped around it: what `puzzle dev` warms at
startup, how a saved file becomes a reloaded browser, and what it refuses to do
when something fails.

The goal the whole loop is shaped around is that a warm rebuild costs
milliseconds, and that a failed one never degrades what the browser is being
served.

1. **Startup resolves the app root, sweeps stale scratch trees, and loads
   `puzzle.config.js` exactly once.** The sweep is explicit here because the SPA
   path never calls the one-shot build that would otherwise do it
   ([[DECISION-D153-PUZZLE-SCRATCH-DIR]]).
   - A config that fails to load is non-fatal: dev warns and falls back to the
     zero config, which silently drops Tailwind and `dev.proxy`. The failed
     config is deliberately *not* passed to any build, so the build keeps its
     own hard failure.
2. **The serving mode is fixed for the session.** `output: 'static'` serves real
   static pages; everything else, `hybrid` included, runs the SPA loop
   ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]]). `--fixtures` with static output is
   rejected here, before any build, rather than once per rebuild.
3. **The warm machinery is constructed before anything is served** — the
   incremental esbuild context (one for SPA, three for static), the usage
   scanner memo, the compile cache, and the `tailwindcss --watch` child
   ([[DECISION-D27-FAST-DEV-REBUILDS]], [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]).
   - Any of those failing to construct degrades the session to a cold one-shot
     build per save, warned once. Output is identical; only the cost changes.
4. **The listener binds before the banner prints.** Non-strict mode scans up to
   ten consecutive ports and reports the one it actually bound; the banner and
   the browser-open both read the listener, never the requested port
   ([[DECISION-D90-DEV-PORT-SCAN]]).
5. **An initial build runs, then the recursive watch starts.** `app/` is watched
   recursively, plus a root-level `public/` when it resolves outside `app/`; the
   project root is watched non-recursively so config edits and atomic saves
   surface without dragging in `dist/` or `node_modules/`.
6. **Events accumulate for 150 ms, then arrive as one sorted batch.** Every
   fsnotify op counts, `Chmod` included, because an editor's atomic save can
   surface as nothing else. A denylist drops editor and OS junk — never an
   allowlist, because `public/` legitimately holds `.htaccess`, `_redirects`,
   `.well-known/*`. Config-file paths are split out of the batch here.
7. **Content-hash echo suppression drops re-saves the loop itself caused.** A
   path whose bytes match what was last accepted is dropped, but only inside a
   short window opened by a *successful* rebuild — a hash, not mtime, so a
   byte-identical re-save is a genuine no-op, and window-scoped so `touch` and a
   retry after a failure always rebuild.
8. **The batch is classified, and the verdict is the most conservative of its
   members.** The SPA path asks a coarse question — does this batch contain a
   `.pzl` (usage scan), does it touch the bundle's input graph (esbuild),
   is it public-only (mirror and stop). Static asks a per-route one
   ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]).
   - Anything the classifier cannot place — an unknown file, a vanished file, an
     empty batch, a graph never captured — is a full rebuild. It only ever
     narrows on evidence.
9. **The rebuild runs against warm state.** esbuild owns its own input-graph
   invalidation; the framework only replaces a context when something frozen
   into it changed — a feature define flipping, or the static page pass's entry
   set changing.
10. **The result is published, differently per mode.** SPA writes into the live
    `dist/`; static assembles a complete staging tree and swaps it atomically,
    because a prerendered site cannot be patched in place without a window where
    pages and bundles disagree.
11. **The browser is told over SSE.** A success clears any retained error
    immediately and sends a `reload` through a 100 ms coalescer; a failure sends
    `builderror` immediately, uncoalesced, and sends no reload
    ([[DECISION-D92-DEV-ERROR-OVERLAY]]).

Steps 6 through 11 are the loop. Step 5's watcher calls the rebuild
synchronously, so nothing drains fsnotify while a rebuild is in flight — which
is precisely why step 7's echo filter exists.

## What stays warm, and what is cold on purpose

Warm for the life of the session: the esbuild contexts and their parse/resolve
caches, the `<style>` collector inside each plugin instance, the usage-scanner
memo, the Tailwind child, the symlink-resolution memo, and — static only — the
compile cache with its SVG memo and the warm output tree under `.puzzle/tmp/`.
The SPA path deliberately attaches no compile cache; esbuild's own `onLoad`
result cache is the only memo it needs.

Cold on every rebuild, deliberately: the `node` prerender subprocess in static
mode, the staging tree, and public-asset validation. A persistent render worker
is the largest remaining lever and is out of scope — it means owning module
invalidation inside a long-lived Node process and reasoning about app-level
global state surviving between renders.

A context is also thrown away — cold — whenever a value frozen into it changes.
That costs the whole incremental graph, which is why the set of such values is
kept to two: the feature defines, and the static page pass's entry set.

## `output: 'static'` runs a different loop

Hybrid stays on the SPA loop because a hybrid site *is* the SPA bundle after
takeover — the SPA loop already shows what ships. Only `static` changes the
loop, and it changes it substantially ([[FLOW-PRERENDER]]):

- Every rebuild runs the real pipeline — bundle, Tailwind, prerender, per-page
  modules — and swaps a complete tree. There is no `app.js` and no router in
  what is served, so the developer sees the artifact rather than a router that
  will not ship.
- The app-bundle esbuild pass still runs, with its bytes discarded. It exists
  only to compile every view once (surfacing errors) and to fill the `<style>`
  collector.
- Only the routes the save can reach are rendered. Every other page is
  hardlinked out of the tree currently being served into the new staging tree,
  so the swap still publishes a complete site, and the bytes match a one-shot
  `--static` build either way.
- A styles-only change renders **zero** routes: the composed stylesheet is
  swapped into the served tree on its own. This is load-bearing rather than an
  optimization — a Tailwind-triggered rebuild carries no changed paths, so the
  classifier could only ever answer "render everything", and the warm child
  rewrites its output after every save.
- The reload client is injected into **every** HTML page at serve time, since
  there is no single shell; the 404 page carries it too, so a page self-heals
  once its route exists. Disk stays production-clean in both modes.

## Failure contract

A failed rebuild never degrades what is being served. Static discards the
staging tree, so `dist/` is untouched. SPA leaves `dist/` as it was, and the CSS
snapshot keeps returning the last fully-successful composition — candidate CSS
mutated by partially-succeeded loads is never observable.

The error is printed, retained on the server, and broadcast. Retention is what
makes a refresh-while-broken keep showing the error instead of appearing to fix
it, and an SSE client registers with the hub *before* reading the retained
error, so a build transition racing a connection can at worst deliver a harmless
duplicate rather than fall between the two and be missed.

With no `dist/index.html` at all and an error retained, the server answers 503
with a self-contained error shell that carries the reload client — so a
first-ever failed build self-heals on the next successful one instead of showing
a bare 404.

After a failure the echo filter's seen-hash map is wiped, so the next save
retries even if the bytes are identical.

## Ordering constraints that look arbitrary

- **Bind before banner.** A dead port must never print a ready line or open a
  browser tab.
- **Wait for Tailwind's first output before the initial static build.** Skip it
  and the first prerender bakes an empty stylesheet into every page, then throws
  the whole build away on the catch-up rebuild.
- **Classify before evicting the compile cache.** The `{#svg}` inline-asset edge
  is the one dependency no metafile carries; the classifier reads it out of the
  cache's asset index, and eviction is exactly what drops it.
- **Render-wide membership is tested before page attribution.** The two sets
  genuinely overlap — a store seed run by a lifecycle hook that one view also
  imports — and attributing such a module to its importing pages would leave
  every other page serving stale HTML and a stale data island for the rest of
  the session, with no periodic full render to wash it out.
- **Promote the captured graph and the pending change set only after the swap
  succeeds.** Adopting the graph from a rebuild whose swap failed would let the
  next save render its own routes and then hardlink genuinely stale pages back
  in as "last-good".
- **Prune the style collector from the metafile, not from load callbacks.** A
  `.pzl` still on disk but no longer imported never re-runs its load, so only
  the metafile reveals that its `<style>` must be dropped.
- **The warm static output tree sits at the same directory depth as a staging
  tree.** esbuild bakes output-relative paths into every source map; any other
  depth makes dev source maps differ from a one-shot build's. Its name also
  deliberately avoids the sweep prefixes, so an idle session cannot have its warm
  tree deleted out from under live contexts.

## Config changes are advisory

`puzzle.config.js` is read once, at startup. A change to it prints a message
asking for a restart and triggers nothing else — no rebuild, no reload, no
re-read. `output`, `build.splitting`, `dev.proxy` and the whole style pipeline
are frozen for the session, and the loaded config is threaded into every build
this session runs so dev and its builds cannot disagree about what the config
says.

## State across the reload

The reload is a full page load, not a module swap
([[DECISION-D57-HMR-STATE-RELOAD]]). Before reloading, the client asks the app
for a snapshot of store records and JSON-safe local view state; the store is
restored before navigation and local state after mount. The snapshot attempt is
best-effort — the reload happens even if it throws — and in static output the
hook simply does not exist, so it is a caught no-op and the page reloads plain.
Production bundles tree-shake the whole path.
