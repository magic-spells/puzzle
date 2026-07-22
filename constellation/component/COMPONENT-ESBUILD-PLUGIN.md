---
name: esbuild plugin and build pipeline
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-FORMATTERS
  - COMPONENT-SSG
  - FLOW-BUILD
  - FILE-ESBUILD-PLUGIN
  - FILE-BUILD
  - FILE-BUILD-OPTIONS
  - FILE-BUILD-WATCH
  - FILE-BUILD-PRERENDER
  - FILE-CONFIG
  - FILE-STYLES
  - FILE-STYLES-WATCH
verified_at: '2026-07-22T00:04:07.365Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
---

# esbuild plugin and build pipeline

The `.pzl` onLoad plugin reads a file, splits/parses it, generates JavaScript,
and returns positioned esbuild messages without writing intermediate modules.
Scripts use JS or TS loader according to `<scripts lang>`; styles collect in a
mutex-protected path map; inline SVG dependencies join esbuild's watch set.

Build bundles `app/app.js` to staged `dist/app.js`, writes linked source maps
and composed CSS, then copies public assets. Production targets ES2022,
minifies, and drops console calls unless `build.dropConsole: false`; development
keeps readable output and console. Failed builds discard staging and preserve
the last good dist. Success renames old output aside, installs staging, then
removes the backup. Path-containment guards protect every swap target.

Public assets come from `app/public` with a root `public` fallback. Reserved
generated names (`app.js`, its map, `styles.css`) are rejected case-insensitively
before pruning or on every dev rebuild. Successful dev rebuilds mirror deleted
public files and prune CSS for `.pzl` modules no longer in the esbuild metafile;
failed rebuilds keep last-good assets/CSS.

JavaScript `puzzle.config.js` loads once through a bounded Node process; Go
never parses it. Styles support the Tailwind-first pipeline. Production runs a
one-shot CLI; dev maintains a warm watcher. Collected component CSS follows
Tailwind output, and scoped blocks wrap in `@scope ([data-<path-hash>])` using
the same symlink-normalized app-relative name as codegen.

Resolution aliases the root package, `/morph`, and `/ssg` for in-repo builds.
The zero-config `@` key resolves `@/…` from `app/` in both browser and prerender
bundles without capturing scoped packages. Relative and installed-package
resolution remain normal esbuild behavior.

Formatter tree-shaking scans project `.pzl` files for built-in use, intersects
the embedded manifest, and serves a virtual module importing only needed
functions. The scan errs toward inclusion; runtime missing-name handling is the
fail-soft guard. Dev rescans on every rebuild. A suspected manifest-staleness bug
across incremental rebuilds was disproven — esbuild re-runs a virtual module's
`OnLoad` on every rebuild — and is regression-guarded by
`TestFormatterManifestFreshAcrossIncrementalRebuilds`.

Static output performs a second node-platform bundle and runs
[[COMPONENT-SSG]] before the staging swap. A timeout or render failure preserves
the last good dist and surfaces source-mapped user errors.
