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
verified_at: '2026-08-16T04:34:42.074Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

# D152 — Build-scoped compile cache: one transform per source, shared by every esbuild pass

## Context

A `puzzle build --static` runs THREE esbuild passes over the same sources: the
browser `app.js` bundle, the node-platform prerender bundle, and the per-page
browser bundles. Each was constructed independently — its own `plugin.New`, its
own project usage scan, its own `.pzl` onLoad work — so the compiler read and
parsed the whole project three times to produce results that could only ever be
identical. Per `.pzl` that was three reads, six `SplitSections`/`ParseTemplate`
walks and three `codegen.Compile` runs; per `{#svg}` asset it was one read and
one `ScanSVGFile` per USE SITE per pass, plus another for the shared asset
module. Independence was never a design goal — it was what "construct a plugin
for this pass" happened to mean.

## Decision

One `passContext` per `build.Build` owns the state every pass shares, and is the
only way build code constructs a `*plugin.Plugin`. It carries two memos:

- **The usage scan.** `plugin.ScanUsage` runs once; every pass's plugin receives
  the same immutable `Usage`, so the esbuild `Define` map and the virtual
  formatter manifest are identical by construction rather than by three walks
  agreeing.
- **`plugin.CompileCache`,** the `.pzl` transform memo, keyed on app root +
  resolved path + a sha256 of the file bytes, with a `sync.Once` per key so
  concurrent onLoad callers collapse onto one compute. It carries a nested
  `codegen.SVGCache` keyed per asset path, which codegen (`Options.SVGCache`)
  and the shared-asset virtual module loader both consume.

Sharing is sound because the transform is PASS-INDEPENDENT: the generated module
is a pure function of (app root, path, bytes). Platform, dev/prod defines,
minification, splitting and source maps live in the esbuild `BuildOptions` and
are applied to the transform's output, not to its inputs; the plugin's only
other input, `SVGDedup`, is always on for this path.

What remains per-pass is exactly what belongs to a pass: registering the file's
`<style>` block in THAT plugin's CSS collector (and, as before, not at all when
the file failed to compile — a broken file must not drop the last good block),
and returning fresh copies of the message and watch-file slices so no pass can
mutate the shared entry.

Codegen's out-of-band warnings print from the memo's compute function, so they
appear **once per build** instead of once per pass.

Lifetime is exactly one `Build` call, so there is no invalidation problem to
solve. `WatchBuilder` (the SPA dev loop) attaches no cache: its plugin outlives
a rebuild, and esbuild's own incremental onLoad cache remains the only memo
there.

The `{#svg}` scan is memoized but never SKIPPED, not even in dedup mode where
`emitRawSVG` discards the scanned attrs. "Valid" is defined by the scan — a
`<div>` root has to fail the `.pzl` compile with a `ParseError` positioned
inside the SVG — and no cheaper existence check reproduces that. Memoizing turns
"once per use site" into "once per file", which is the same order of saving with
the diagnostic intact. Scanned attrs are copied per use site, because `forBody`
prepends a synthetic loop `key` that a shared slice would write through into
every other use of the icon.

## Alternatives rejected

- **One `Plugin` shared by all three passes.** The CSS collector is per-pass
  state — the prerender and per-page passes deliberately discard theirs — and a
  single instance would merge three collectors into one map with no way to tell
  the passes apart.
- **Key the memo per pass (platform, defines, dev/prod).** Those inputs do not
  reach `onLoad`; per-pass keys would triple the cache for three identical
  entries and reintroduce exactly the work being removed.
- **Key on path alone, no content hash.** Cheaper, and correct only as long as
  nothing rewrites a source mid-build. The hash costs one pass over bytes
  already in memory and removes the assumption.
- **A process-lifetime cache with invalidation.** The cross-build case belongs
  to the dev loop, which already has esbuild's incremental cache; adding
  invalidation logic here would buy nothing a one-shot build can use.
- **Print codegen warnings on every pass.** Truthful about the number of
  transforms attempted, useless to a reader: three identical advisories make a
  static build's log look like three separate failures.

## Consequences

Static builds do one usage scan, one transform per `.pzl`, and one read + scan
per `{#svg}` asset. Emitted bytes are unchanged — the cache-hit path is proved
equivalent to a cold pass (same bundled JS, same collected CSS, same positioned
errors) by `TestCachedPassMatchesUncachedPass` and friends. `passContext` being
mandatory also closes a latent hazard: a pass added later cannot silently start
from an unscanned, all-false `Usage` and drop a used runtime module from its
bundle.
