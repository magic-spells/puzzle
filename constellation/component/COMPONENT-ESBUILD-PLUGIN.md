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
verified_at: '2026-07-25T05:26:57.523Z'
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
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
never parses it. Optional scalar keys (`build.dropConsole`, `build.sourceMap`,
`output`) are decoded from `json.RawMessage`, and "was this key set?" is a
shared `unset()` helper that treats **JSON `null` as unset**, not just an absent
key. A length check alone is wrong: `null` decodes to a four-byte
`RawMessage`, and `json.Unmarshal` of `null` into a scalar is a documented no-op
that returns no error and leaves the zero value — so `dropConsole: null` read as
an explicit `false` and silently flipped production from strip-console to
keep-console, while `output: null` failed with the confusing `output "" is not
supported`. Styles support the Tailwind-first pipeline. Production runs a
one-shot CLI; dev maintains a warm watcher. Collected component CSS follows
Tailwind output, and scoped blocks wrap in `@scope ([data-<path-hash>])` using
the same symlink-normalized app-relative name as codegen.

Resolution aliases the root package, `/morph`, `/ssg`, `/static`, and
`/fixtures` for in-repo builds. Under `--fixtures` (D98) the entry point is a
generated wrapper whose two imports a small resolver plugin pins
`SideEffects: true` — the package declares `"sideEffects": false`, and without
the pin esbuild tree-shakes both bare wrapper imports into an empty bundle.
The zero-config `@` key resolves `@/…` from `app/` in both browser and
prerender bundles without capturing scoped packages. Relative and
installed-package resolution remain normal esbuild behavior.

Build-time usage tree-shaking walks first-party project sources with the same
fail-soft, over-inclusive policy as D31: unreadable or unparseable files are
skipped and generated/vendor trees are pruned. Parsed `.pzl` ASTs still seed
the virtual formatter manifest from observed built-ins, while element attrs or
component props named `flip` drive the literal `__PUZZLE_HAS_FLIP__` esbuild
define. Since [[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]] that is the ONLY
usage define: the managed-head gate and its raw `.js`/`.ts` token scan are gone,
so the walk reads only `.pzl` files. Every one-shot, watch/dev, and per-page
static bundle recomputes or receives the same usage so the runtime probes fold
without risking a false-negative. Esbuild
re-runs the formatter virtual module's `OnLoad` on every rebuild; this is
regression-guarded by `TestFormatterManifestFreshAcrossIncrementalRebuilds`.

Static output performs a second node-platform bundle and runs
[[COMPONENT-SSG]] before the staging swap. A timeout or render failure preserves
the last good dist and surfaces source-mapped user errors.
