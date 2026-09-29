---
name: 'D152 — Build-scoped compile cache: one transform per source, shared by every esbuild pass'
status: verified
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-SSG
  - COMPONENT-COMPILER-CLI
  - FILE-ESBUILD-PLUGIN
  - FILE-BUILD
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
  - FLOW-BUILD
  - DECISION-D46-INLINE-SVG
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D152 — Build-scoped compile cache: one transform per source, shared by every esbuild pass

## Context

A static build runs three esbuild passes over the same sources — browser
`app.js`, the node prerender bundle, and per-page browser bundles. Independent
plugins would scan usage, read, split, parse and compile every `.pzl` (and scan
every `{#svg}` per use site) once per pass, for identical results.

## Decision

One `passContext` per build (`compiler/internal/build/passctx.go`) is the only
way build code constructs a `*plugin.Plugin`. It shares:

- **The usage scan** — `plugin.ScanUsage` runs once; every pass gets the same
  immutable `Usage`, so `Define` maps and the formatter manifest match by
  construction. A pass can't start from an unscanned all-false `Usage`.
- **`plugin.CompileCache`** — the `.pzl` transform memo, keyed on app root +
  path + sha256 of the bytes, one `sync.Once` per key so concurrent onLoads
  collapse. It carries a nested `codegen.SVGCache` (per asset path) used by
  codegen and the shared-asset virtual module.

Sharing is sound because the transform is pass-independent: platform, defines,
minify, splitting and source maps are esbuild options applied after onLoad.

Per pass: register the file's `<style>` into that pass's CSS collector (not at
all when the file failed, so the last good block survives) and return fresh
copies of message and watch-file slices. Codegen warnings print from the
memo's compute, so once per build.

**Scope**: one `Build` for `puzzle build`; the whole session for
`StaticWatchBuilder` ([[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]). The content
hash makes an edited file miss; `Evict` bounds growth and clears the SVG memo,
which is keyed by path. `CompileCache` also records `{#svg}` asset → consuming
`.pzl` edges for route-level invalidation
([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]). `WatchBuilder` (SPA dev) attaches
no cache; esbuild's incremental cache is its only memo.

The `{#svg}` scan is memoized but never skipped — the scan defines validity (a
`<div>` root must fail with a positioned error). Scanned attrs are copied per use
site because `forBody` prepends a synthetic `key`.

## Alternatives

- One `Plugin` shared by all passes — CSS collectors are per-pass state.
- Keying per pass (platform/defines) — those don't reach onLoad; triples
  identical entries.
- Path-only key — breaks if a source changes mid-build or between dev
  rebuilds.

## Consequences

A static build does one usage scan, one transform per `.pzl` and one scan per
`{#svg}` asset, with unchanged output bytes — proved by
`TestCachedPassMatchesUncachedPass` (`compiler/internal/plugin/cache_test.go`).
