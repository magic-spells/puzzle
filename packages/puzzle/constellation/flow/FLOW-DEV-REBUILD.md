---
name: Dev rebuild loop
status: verified
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
  - FLOW-BUILD
  - FLOW-PRERENDER
  - DOC-SPEC-BUILD
  - DOC-DEVELOPMENT
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Dev rebuild loop

The loop `puzzle dev` wraps around the shared pipeline ([[FLOW-BUILD]]): what it warms,
how a save becomes a reloaded browser, and what it refuses to do on failure. Goal: a warm
rebuild costs milliseconds, and a failed one never degrades what is served. Component
detail lives on [[COMPONENT-DEV-SERVER]].

1. **Startup**: resolve the root, runtime preflight, sweep stale scratch trees (the SPA
   path never calls the one-shot build that would, [[DECISION-D153-PUZZLE-SCRATCH-DIR]]),
   load `puzzle.config.js` exactly once. A failed config load falls back to the zero
   config with a warning and is NOT passed to builds (they keep their hard failure).
2. **Fix the serving mode**: `output: 'static'` serves real static pages; everything else,
   `hybrid` included, runs the SPA loop ([[DECISION-D148-PREVIEW-AND-STATIC-DEV]]).
   `--fixtures` + static is rejected here.
3. **Warm the machinery** before serving: incremental esbuild context(s) (one SPA, three
   static), the usage-scanner memo, the compile cache (static only), and the
   `tailwindcss --watch` child ([[DECISION-D27-FAST-DEV-REBUILDS]],
   [[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]). A construction failure degrades to a
   one-shot build per save — same output, higher cost.
4. **Bind, then print the banner** (port scan, [[DECISION-D90-DEV-PORT-SCAN]]).
5. **Initial build, then watch** `app/` and `public/` recursively, the root
   non-recursively (config edits and atomic saves only).
6. **Batch** events for 150 ms (every op counts, `Chmod` included); drop junk by
   denylist; split out config paths — a config change only prints "restart" and triggers
   nothing (`output`, `build.splitting`, `dev.proxy` and the style pipeline are frozen
   for the session).
7. **Echo suppression**: drop paths whose bytes match the last accepted batch, only inside
   the window a successful rebuild opens. Needed because the watcher calls the rebuild
   synchronously, so nothing drains fsnotify while it runs.
8. **Classify** — the verdict is the most conservative member's. SPA: does it contain a
   `.pzl` (usage scan), touch the bundle graph (esbuild), or is it public-only (mirror and
   stop)? Static: which routes can it reach ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]])?
   Anything unplaceable is a full rebuild; it only narrows on evidence.
9. **Rebuild on warm state.** esbuild owns graph invalidation; a context is replaced only
   when a value frozen into it changes — a feature define, or the static page pass's
   entry set.
10. **Publish**: SPA writes into the live `dist/`; static assembles a complete staging
    tree (unrendered pages hardlinked from the served tree) and swaps atomically. A
    styles-only change in static renders ZERO routes and swaps just the stylesheet — a
    Tailwind trigger has no changed paths, so the classifier could only say "everything".
11. **Notify over SSE**: success clears any retained error and sends `reload` through a
    100 ms coalescer; failure sends `builderror` immediately with no reload
    ([[DECISION-D92-DEV-ERROR-OVERLAY]]).

## Static specifics ([[FLOW-PRERENDER]])

Every rebuild runs the real pipeline (bundle, Tailwind, prerender, per-page modules), so
the developer sees the artifact, not a router that won't ship. The app-bundle pass still
runs with its bytes discarded — it compiles every view (surfacing errors) and fills the
`<style>` collector. The reload client is injected into every HTML page (including the
404 page, so a new route self-heals). The `node` prerender subprocess stays cold per
rebuild; a persistent render worker is the biggest remaining lever and is out of scope
(module invalidation and app global state in a long-lived Node process).

## Failure contract

Static discards staging, so `dist/` is untouched; SPA leaves `dist/` as it was and the
CSS snapshot keeps the last fully successful composition. The error is printed, retained
and broadcast; an SSE client registers with the hub BEFORE reading the retained error, so
a racing transition can only duplicate, never be missed. With no `dist/index.html` and an
error retained, the server answers 503 with an error shell carrying the reload client, so a
first-ever failed build self-heals. A failure wipes the echo filter's memo.

## Ordering constraints that look arbitrary

- **Wait for Tailwind's first output before the initial static build**, or every page
  bakes an empty stylesheet.
- **Classify before evicting the compile cache** — the `{#svg}` asset edge is read from the
  cache's asset index, and eviction drops it.
- **Test render-wide membership before page attribution** — the sets overlap (a store seed
  run by a lifecycle hook that one view also imports); attributing it to one page would
  leave every other page stale for the session.
- **Promote the captured graph and pending set only after the swap succeeds**, or the next
  save hardlinks stale pages back in as last-good.
- **Prune the style collector from the metafile**, not load callbacks — a `.pzl` still on
  disk but no longer imported never re-runs its load.
- **The warm static output tree sits at staging depth** (esbuild bakes output-relative
  paths into source maps) and its name avoids the sweep prefixes (an idle session must not
  lose it).

## State across the reload

A full page load, not a module swap ([[DECISION-D57-HMR-STATE-RELOAD]]): the client asks the
app for a snapshot (records, local view state, D161 read state) before reloading; the
store restores before navigation, local state after mount ([[COMPONENT-DEVSTATE]]). The
snapshot is best-effort; in static output the hook doesn't exist and the page reloads
plain. Production tree-shakes the whole path.
