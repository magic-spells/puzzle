---
name: D160 — Opt-in SPA code splitting via build.splitting
status: verified
connections:
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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

## Context

SPA output has nowhere to split to, so one heavy on-demand dependency (e.g. `import('mermaid')`) is paid for on every page load. esbuild's ESM splitting has no chunk-loader runtime, so splitting moves bytes out of `app.js` without adding any.

## Decision

`build: { splitting: true }` in `puzzle.config.js` makes a dynamic `import()` in the SPA bundle emit a lazy chunk under `dist/chunks/[name]-[hash]` instead of inlining it. Default off; `Config.Splitting()` is the only place the default lives. The entry keeps its stable `app.js` name.

- **Static mode forces it off** (`cfg.Splitting() && mode != "static"`, resolved before `ValidatePublic`): static deletes `staging/app.js`, so its chunks would be orphans. Hybrid keeps splitting — its bundle is the shipped runtime after takeover. (The static per-page pass splits its own page entries independently.)
- **Dev builder prunes.** With splitting on, `puzzle dev` runs the pass with `Write: false`, writes outputs itself via `writeSplitOutputs` (`fsutil.WriteFileAtomic` — lazy fetches can land mid-rebuild), and deletes only paths it wrote on the previous pass that this pass did not emit. With the flag off, the single-file dev path is unchanged.
- **`chunks/` is reserved only while the flag is on** — `ValidatePublic(root, splitting, i18n)` takes the boolean, so non-opting apps keep `public/chunks/`.
- **`AbsWorkingDir` is not anchored on this pass**, unlike the static-pages pass: `metafileAllInputs` resolves metafile keys against the process cwd for dev CSS pruning and the public-only rebuild shortcut. Dev chunks therefore carry cwd-relative path comments; production minifies them away.
- **Size banner composition report** (`compiler/cmd/puzzle/summary.go`): bytes grouped by package under the innermost `node_modules/`, with a production-only warning past 200 KB for one dependency; it skips app code and the framework runtime, which can't be moved behind `import()`.
- Splitting correctness depends on the embedded esbuild being current (0.28.x); older versions had cross-chunk ordering and circular-dep bugs.

## Alternatives

- On by default — changes the shape of `dist/` (more files, hashed names, new directory); the flip is its own later change.
- Permanent `chunks/` reservation — takes a directory name from every app to serve the ones that opt in.
- Sweeping `dist/chunks` before each dev rebuild — races the browser mid-fetch; the output-set diff deletes only what went stale.
- Splitting in static mode and deleting orphans after — means reimplementing reachability over the metafile.

## Consequences

Heavy on-demand dependencies leave `app.js` with no runtime cost. Lazy route views (D163) build on this flag.
