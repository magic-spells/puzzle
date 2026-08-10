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
The transform itself is pass-INDEPENDENT — the generated module is a pure
function of (app root, path, bytes), since platform, dev/prod, defines and
minification are applied to it afterwards by esbuild — so a one-shot build
memoizes it in a build-scoped `CompileCache` shared by all three plugin
instances. A pass that hits the memo still does its own per-pass work:
registering the file's `<style>` block in ITS collector (never on a failed
compile) and returning fresh copies of the message/watch-file slices. Codegen's
out-of-band warnings print from the memo's compute function, so they appear once
per build rather than once per pass. The SPA watch/dev path attaches no cache, which keeps
esbuild's own incremental onLoad cache the only memo there; the STATIC dev
builder holds one for the whole session ([[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]).
Cross-rebuild reuse is safe because the key carries a content hash — an edited
file simply misses — but `Evict` still exists, indexed by a path→keys map that
records both a `.pzl`'s own path and every file it inlines with `{#svg}`: the
SVG memo nested inside the cache is keyed by PATH, so an edited icon whose
consuming `.pzl` is byte-identical would otherwise be served from the pre-edit
scan with nothing able to notice. Both sides of an eviction are symlink-resolved
(esbuild reports resolved paths, a watcher reports what the user spelled).
That same `{#svg}` edge is also indexed the OTHER way round, asset → the `.pzl`
files that inline it (`AssetConsumers`), because an inlined asset is a codegen
watch file rather than an esbuild input and route-level invalidation
([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]) has no metafile that can place it.
Those entries are never removed: a stale one can only over-report consumers, and
an over-reported consumer costs one re-render.

The project usage walk has the same shape of problem: it reads and fully parses
every `.pzl` to answer two questions (which builtins are called, is `flip`
used), which a one-shot build pays once and a dev session paid per rebuild.
`plugin.UsageScanner` is that walk with a per-file memo keyed by path + mtime +
size; `ScanUsage` is now a one-shot scanner, so the two share `scanFileUsage`
and cannot answer differently. Both long-lived builders keep one scanner for the
session.
Scripts use JS or TS loader according to `<script lang>`; styles collect in a
mutex-protected path map; inline SVG dependencies join esbuild's watch set.

[[DECISION-D156-BUILD-PIPELINE-PERFORMANCE]] makes the SPA
call site honor that incremental shape: startup reuses the constructor scan and
non-`.pzl` batches do not re-walk the project. The CSS collector gains a
monotonic revision that changes only when a block is added, changed, or pruned,
letting dev skip composition when an incremental graph rebuild leaves styles
identical. The watch builder promotes the working collector to a committed
snapshot only after full rebuild success; Tailwind callbacks read that snapshot
so a partially successful esbuild pass cannot leak CSS beside last-good JS.
Static dev similarly promotes its candidate only after the staging swap, and
its styles-only path reads the committed snapshot.

Public-only SPA batches mirror assets without rebuilding the browser graph when
the changed paths were not inputs to the previous successful metafile. Public
files imported by application code remain ordinary graph inputs and rebuild as
before.

Build bundles `app/app.js` to staged `dist/app.js`, writes linked source maps
and composed CSS, then copies public assets. Its three passes' BuildOptions are
assembled by `newBundleOptions`, `prerenderBundleOptions`, and
`staticPagesBundleOptions` — extracted so the static dev builder can hold the
identical passes open as persistent contexts and the shipped bytes cannot depend
on which driver ran them. The per-page pass anchors `AbsWorkingDir` to its
output tree: unminified output carries a `// <input path>` comment per module
resolved against the process cwd, so the staging dir's random suffix used to
leak into `_puzzle/*.js` and two dev builds of identical sources produced
different bytes. Production is unaffected (minification strips the comments). Production targets ES2022,
minifies, and drops console calls unless `build.dropConsole: false`; development
keeps readable output and console. Failed builds discard staging and preserve
the last good dist. Success renames old output aside, installs staging, then
removes the backup — inline for a one-shot build (the process is about to exit),
backgrounded for a dev rebuild, where deleting a 150-page tree is ~50ms a
developer would otherwise wait through after the swap has already succeeded. Path-containment guards protect every swap target.

Under D156, one-shot browser bundling and Tailwind generation overlap behind
deterministic browser-before-Tailwind error collection. Styles compose after
the browser pass has populated its per-pass CSS collector; public copying and
prerendering retain their order, so concurrency changes elapsed time rather
than public collision, user-code execution, or artifact semantics.

Every transient directory a build needs lives under `<root>/.puzzle/tmp/` —
the staging tree (`staging-*`) and swapOutput's holding dir for the previous
output (`dist-old-*`), which used to be `.dist-staging-*` / `dist.old-*`
siblings of `dist/`. Same filesystem, so the install is still an atomic rename;
but `<root>/.puzzle` carries a `.gitignore` holding `*`, so a leftover from a
killed build is invisible to every tool that respects gitignore. That matters
beyond tidiness: Tailwind v4 walks the project for sources, and a stale copy of
`dist/` under a name no `dist` ignore rule matches turned a 112ms source scan
into 14s on the reference site. `Build` and `puzzle dev` both call
`SweepWorkDirs` at startup, which removes entries under `.puzzle/tmp` — and
legacy `.dist-staging-*` / `dist.old-*` siblings, so existing projects self-heal
— matching the exact known prefixes, real directories only (never a symlink),
untouched for over ten minutes so a concurrently running build survives.

Public assets come from `app/public` with a root `public` fallback. Reserved
generated names (`app.js`, its map, `styles.css`) are rejected case-insensitively
before pruning or on every dev rebuild. The copier writes differently per
destination: into the private staging dir a plain write (no reader exists yet,
so an atomic temp+rename buys nothing), and into the live `dist/` an atomic
write that also SKIPS any file already matching on size + mtime — normally the
whole tree on an incremental rebuild. Live-dist copies stamp the source mtime so
that comparison stays meaningful. Staging deliberately copies rather than
hardlinks: the prerender passes edit staging's copy of `public/index.html` in
place, and a shared inode would write through into the app's own source asset. Successful dev rebuilds mirror deleted
public files and prune CSS for `.pzl` modules no longer in the esbuild metafile;
an esbuild failure skips that public pass and D156 keeps working CSS private.
The SPA public mirror writes live: an I/O failure after some successful copies
can leave those assets updated, but its ownership set does not advance and the
next public sync retries the full mirror. Full-output atomicity belongs to the
staged one-shot/static pipelines, not the SPA incremental path.

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
so the walk reads only `.pzl` files. The scan runs ONCE per `build.Build`
and its immutable result is threaded to every pass through a `passContext` —
the constructor build code uses instead of `plugin.New`, so a pass cannot start
from an unscanned zero `Usage` and drop a used runtime module. A static build's
three esbuild passes previously each redid the walk over identical bytes. Only
the long-lived watch/dev builder still re-scans, and only when a `.pzl` changed. Esbuild
re-runs the formatter virtual module's `OnLoad` on every rebuild; this is
regression-guarded by `TestFormatterManifestFreshAcrossIncrementalRebuilds`.

Static output performs a second node-platform bundle and runs
[[COMPONENT-SSG]] before the staging swap. A timeout or render failure preserves
the last good dist and surfaces source-mapped user errors. The per-page browser
bundle pass follows the SAME source-map policy as the main `app.js` pass —
development linked, production only under `build.sourceMap` — decided BEFORE
esbuild runs rather than by emitting maps unconditionally and deleting them
after. Because a chunk's content hash is computed over bytes that no longer
carry a `sourceMappingURL` comment, production `_puzzle/chunks/*` filenames
differ from the generate-then-strip era; the contents are unchanged, and the
hash now actually describes the shipped bytes.
