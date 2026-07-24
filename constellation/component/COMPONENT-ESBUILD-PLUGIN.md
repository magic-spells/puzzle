---
name: esbuild plugin and build pipeline
status: built
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
verified_at: '2026-07-23T16:30:49.295Z'
verified_sha: 93ebefacfc0dcd35ea787a1f09b56aa308bea4f9
---

# esbuild plugin and build pipeline

The `.pzl` onLoad plugin reads a file, splits/parses it, generates JavaScript,
and returns positioned esbuild messages without writing intermediate modules.
Scripts use JS or TS loader according to `<script lang>`; styles collect in a
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
The zero-config `@` key resolves `@/…` from `app/` in both browser and
prerender bundles without capturing scoped packages. Relative and
installed-package resolution remain normal esbuild behavior.

Build-time usage tree-shaking walks first-party project sources with the same
fail-soft, over-inclusive policy as D31: unreadable or unparseable files are
skipped and generated/vendor trees are pruned. Parsed `.pzl` ASTs still seed
the virtual formatter manifest from observed built-ins, while element attrs or
component props named `flip` and raw `.js`/`.ts`/`.pzl` head-field tokens drive
literal `__PUZZLE_HAS_FLIP__` and `__PUZZLE_HAS_HEAD_TAGS__` esbuild defines. Every
one-shot, watch/dev, and per-page static bundle recomputes or receives the same
usage so the runtime probes fold without risking a false-negative. Esbuild
re-runs the formatter virtual module's `OnLoad` on every rebuild; this is
regression-guarded by `TestFormatterManifestFreshAcrossIncrementalRebuilds`.

Static output performs a second node-platform bundle and runs
[[COMPONENT-SSG]] before the staging swap. A timeout or render failure preserves
the last good dist and surfaces source-mapped user errors.
