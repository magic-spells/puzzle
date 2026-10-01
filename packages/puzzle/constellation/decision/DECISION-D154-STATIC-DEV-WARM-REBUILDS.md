---
name: D154 — warm static dev rebuilds
status: verified
connections:
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D27-FAST-DEV-REBUILDS
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - DECISION-D153-PUZZLE-SCRATCH-DIR
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D156-BUILD-PIPELINE-PERFORMANCE
  - COMPONENT-DEV-SERVER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-BUILD-WATCH
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - compiler/internal/build/watch_static.go
  - compiler/internal/dev/dev.go
---

# D154 — warm static dev rebuilds

## Context

[[DECISION-D148-PREVIEW-AND-STATIC-DEV]] makes static dev run the real pipeline,
which done cold per save (fresh Tailwind, three cold esbuild passes, full usage
walk) costs seconds on a large site. `WatchBuilder` (D27) can't be reused
directly: a static build is three passes whose third entry set is known only
after the prerender, and the output must be assembled in a fresh staging tree
and swapped, while an esbuild `api.Context` freezes its `Outdir`.

## Decision

`puzzle dev` on `output: 'static'` rebuilds through a persistent
`build.StaticWatchBuilder` (`compiler/internal/build/watch_static.go`): three
long-lived esbuild contexts, a session-long `CompileCache` and `UsageScanner`,
and the warm `tailwindcss --watch` child. Output is byte-for-byte what
`puzzle build --static` produces; any failure leaves the last good site serving.

- **Warm output root** `<root>/.puzzle/tmp/dev-static/`, laid out like a staging
  tree at the same depth as `staging-*` — esbuild bakes output-relative paths
  into `.js.map`, so any other depth changes sourcemaps. The name matches no
  `SweepWorkDirs` prefix, so an idle session's tree survives.
- **Page and app passes run `Write: false`.** Page `OutputFiles` are written
  into staging, which prunes deleted routes and superseded chunks for free. The
  app pass only compiles views, fills the `<style>` collector and surfaces
  errors (static ships no `app.js`).
- **Contexts are replaced, never mutated, on the two frozen facts**: a usage
  `Features` bit flip (all three Defines) or a route-set change (page entries).
  Everything else is esbuild's own invalidation. When in doubt, tear down.
- **Session memos**: the compile memo is content-hashed; the SVG memo inside it
  is path-keyed and must be evicted on icon edits.
- **Styles-only change writes one file.** A Tailwind output change drives a
  debounced `RecomposeStyles` that atomically swaps `dist/styles.css` alone,
  reloading only when bytes changed. It dedupes against the file on disk, reads
  only the CSS snapshot committed by the last successful swap
  ([[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]]), and is a no-op before the first
  build lands. The initial build waits (bounded) for Tailwind's first output.
- The page pass anchors `AbsWorkingDir` to its output tree so unminified
  `// <input path>` comments don't leak the staging suffix into `_puzzle/*.js`.
- The node prerender is a fresh subprocess per rebuild; which routes it renders
  is [[DECISION-D155-ROUTE-LEVEL-INVALIDATION]].
- Builder construction failure degrades to one-shot `build.Build` per save
  (identical output, own Tailwind run). Deletion of a superseded tree is
  backgrounded; a killed session's `dist-old-*` is reaped by `SweepWorkDirs`.

## Alternatives

- Rebuild the contexts every save — discards the esbuild cache being bought.
- Hardlink/copy a warm `dist/` — esbuild rewrites outputs in place, mutating a
  served tree; a full copy costs more than it saves.
- Patch `dist/` in place — a failed prerender would serve a half-updated site
  (the one-file stylesheet swap is the deliberate exception).
- A stable staging dir shared with `puzzle build` — concurrent dev + build would
  fight over it.
- Persistent node render worker — owns module invalidation and app-global state
  across renders; deferred.

## Consequences

Static dev saves are warm and output-identical to production builds; dev
output is byte-stable across runs and directories.
