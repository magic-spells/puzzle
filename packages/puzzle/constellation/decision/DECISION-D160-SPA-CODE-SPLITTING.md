---
name: D160 — Opt-in SPA code splitting via build.splitting (v1.75)
status: verified
connections:
  - FEATURE-SPA-CODE-SPLITTING
  - DECISION-D09-GO-ESBUILD-COMPILER
  - DECISION-D81-STATIC-PAGES-MODE
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - FILE-BUILD
  - FILE-BUILD-OPTIONS
  - FILE-BUILD-WATCH
  - FILE-CONFIG
  - FILE-CLI
  - DOC-SPEC-BUILD
  - DOC-RELEASE-SURFACE
verified_at: '2026-08-16T04:34:44.168Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

A dynamic `import()` in the SPA bundle emits a lazy chunk instead of being
inlined, behind `build: { splitting: true }` in `puzzle.config.js`. Default off
this release; the accessor is the only place the default lives, so a later
release flips it without changing stored config semantics.

```js
// puzzle.config.js
export default { build: { splitting: true } };
```

```js
// anywhere in app code — this is the whole authoring surface
const { renderChart } = await import('chart.js-wrapper.js');
```

The problem is narrow and expensive: in SPA output there is nowhere to split to,
so one heavy on-demand dependency is paid for on every page load. The motivating
case was the Constellation viewer's `import('mermaid')` growing `app.js` from
~340 KB to 3.4 MB, worked around by vendoring mermaid's chunked ESM outside the
build entirely. Measured here on a starter app with `chart.js` behind an
`await import()`: `app.js` 263.4 KB → 63.6 KB (89.8 KB → 20.9 KB gzip), the
199.3 KB remainder in one chunk, and total shipped bytes unchanged — esbuild's
ESM splitting has no chunk-loader runtime.

**The one-line option change is not the work.** `newBundleOptions` already wrote
ESM through `Outdir`, so the pass needed `Splitting: true` plus
`ChunkNames: "chunks/[name]-[hash]"`. The work is in the three consumers that
assumed exactly one JS output:

- **Static mode must force it off.** `prerenderStaticPages` deletes
  `staging/app.js` before the swap because nothing references it — with
  splitting on, its chunks would survive as orphans nothing imports. The flag is
  therefore `cfg.Splitting() && mode != "static"`, resolved before
  `ValidatePublic` so the reserved-name set is decided once. Hybrid keeps
  splitting: its bundle IS the shipped runtime after takeover.
- **The dev builder had no pruning.** `puzzle dev` keeps `dist/` warm, so every
  content edit to a lazily imported module re-hashes its chunk and the old file
  would linger forever — and ship, if the developer deployed that `dist/`
  without a fresh build. The builder now runs the pass with `Write: false` and
  materializes the outputs itself (the move `StaticWatchBuilder.bundlePages`
  already makes), diffing this pass's output set against the previous one and
  deleting the difference. Scope is deliberately narrow: only paths that builder
  wrote are prune candidates, so the public mirror stays `prevPublic`'s job.
  With the flag off, `Write: true` and none of this runs — the single-file dev
  path is byte-identical to before.
- **`chunks/` becomes a reserved output name**, but only while the flag is on.
  `ValidatePublic` takes the boolean rather than gaining a permanent entry in
  `reservedOutputNames`, because an app that never opts in should keep its
  `public/chunks/` assets. Same shape as the `_puzzle` guard in static mode.

**Embedded esbuild moved 0.19.11 → 0.28.2** in the same change, alone and first
so its byte deltas stay bisectable. ESM splitting correctness (cross-chunk
ordering, circular deps) improved materially after 0.19; shipping a splitting
feature on the old bundler would be shipping its bugs. The only fallout was the
todos size figure (22.5 → 22.4 KB gzip).

**`AbsWorkingDir` is deliberately NOT anchored on this pass**, unlike the
per-page static pass. This pass's metafile input keys are resolved against the
PROCESS working directory by `metafileAllInputs`, which drives dev CSS pruning
and the public-only rebuild shortcut; anchoring the pass would silently break
both whenever the app root is not the cwd. The cost is that unminified dev
chunks carry cwd-relative input-path comments — exactly what `app.js` has always
carried — and production minifies them away.

**The size banner gained a composition report** (metafile `bytesInOutput`
grouped by the package under the innermost `node_modules/`, app code as `app`),
with a warning past 200 KB for a single dependency. Splitting is useless to
someone who cannot see that one dependency IS their bundle; this is the
instrument that would have named mermaid on day one. The warning is
production-only — the threshold describes minified bytes, and on an unminified
dev build everything crosses it — and it skips the app's own code and the
framework runtime, neither of which can be moved behind a dynamic `import()`.
An advisory that fires on every build, naming something you cannot act on, is
noise that teaches people to ignore the banner.

## Alternatives rejected

- **On by default.** Splitting changes the shape of `dist/` — more files, hashed
  names, a new directory — and some hosting setups care. A release or two of
  opt-in costs nothing and lets the default flip be its own, boring change.
- **A permanent `chunks/` reservation.** Cheaper to implement, but it would take
  a directory name away from every app forever to serve the apps that opt in.
- **Letting esbuild keep writing in dev and sweeping `dist/chunks` before each
  rebuild.** A wipe races the browser mid-fetch and throws away chunks the
  rebuild would have re-emitted identically. The output-set diff deletes only
  what actually went stale.
- **Splitting in static mode and deleting orphans afterward.** Detecting which
  chunks were reachable only from the deleted `app.js` means reimplementing
  reachability over the metafile to undo work that never needed doing.
- **Phase 2 (lazy route views) now.** `view: () => import('./Heavy.pzl')` needs
  router await semantics, loading/error states, and prerender interplay — a
  separate design. Phase 1 alone solves the heavy-dependency class of problem.
