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
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# esbuild plugin and build pipeline

`compiler/internal/plugin` (the `.pzl` onLoad plugin, usage scan, virtual manifests) and
`compiler/internal/build` (passes, staging, public assets, defines). The build contract
is [[DOC-SPEC-BUILD]]; the end-to-end order is [[FLOW-BUILD]].

## The `.pzl` transform

The onLoad plugin splits/parses a file, generates JavaScript and returns positioned
esbuild messages, writing no intermediate modules. Scripts use the JS or TS loader per
`<script lang>`; styles collect in a mutex-protected path map; `{#svg}` files join the
watch set.

- **The transform is pass-independent** (a pure function of app root, path, bytes), so a
  one-shot build memoizes it in a build-scoped `CompileCache` shared by all three plugin
  instances. A memo hit still does its per-pass work (register the `<style>` in THIS
  pass's collector, never on a failed compile; fresh message/watch slices). Codegen
  warnings print from the compute function, once per build. The SPA dev path attaches no
  cache (esbuild's incremental cache is the memo); the static dev builder holds one per
  session ([[DECISION-D154-STATIC-DEV-WARM-REBUILDS]]).
- `Evict` is indexed path → keys for a `.pzl` AND every file it inlines with `{#svg}`,
  because the nested SVG memo is keyed by PATH; both sides are symlink-resolved.
  `AssetConsumers` indexes asset → consuming `.pzl` for route-level invalidation
  ([[DECISION-D155-ROUTE-LEVEL-INVALIDATION]]) — entries are never removed (a stale one only
  over-reports).
- Scoped styles wrap via `codegen.ScopedCSS` with the same symlink-normalized
  app-relative name as codegen.

## Usage scan and defines

`scanFileUsage` walks first-party sources fail-soft and over-inclusive (D31): unreadable
or unparseable files are skipped, generated/vendor trees pruned. `.pzl` ASTs yield the
library functions called (the formatter virtual module), `t` literal keys
(`Usage.TKeys`, key → files, for the missing-key warning; runtime-built keys skipped), and
the feature facts behind `__PUZZLE_HAS_FLIP__` (a `flip` attr or prop),
`__PUZZLE_HAS_PORTAL__`, `__PUZZLE_HAS_COMPONENT_SLOT__` (a reserved `<Component>` tag, including nested/skeleton content), `__PUZZLE_HAS_RAW_AT__` (any raw block). `__PUZZLE_HAS_LAZY__`
comes from reading `.js`/`.ts`-family files (and each `.pzl`'s whole source, before its
parse) as TEXT for a `lazy(`-shaped call or a `lazy` specifier imported from
`@magic-spells/puzzle` — `lazy()` lives in `routes.js`, where no template parse reaches.
There is no managed-head gate (managed head tags are build-time only, D84).

- `plugin.UsageScanner` memoizes per file (path + mtime + size); `ScanUsage` is a
  one-shot over the same function, so they cannot disagree. The scan runs ONCE per
  `build.Build` and is threaded to every pass through `passContext` — a pass must never
  start from an unscanned zero `Usage`. Long-lived builders re-scan only on a watched
  change and replace the context when any bit changes. Esbuild re-runs the formatter
  module's `OnLoad` every rebuild (`TestFormatterManifestFreshAcrossIncrementalRebuilds`).
- **i18n** (D175): a second virtual module, `@magic-spells/puzzle/i18n/manifest`;
  `SetI18n(enabled, manifestJS)` sets `__PUZZLE_HAS_I18N__` and the manifest source
  (`export default null` when off), re-read on every OnLoad.
- Build-fact defines: `__PUZZLE_TAKEOVER__` (hybrid, static per-page and dev bundles
  may adopt prerendered DOM; a plain SPA folds those branches and drops
  `ssg/preload.js`) and `__PUZZLE_CAPTURE__` (a static per-page entry imports the app
  entry only to read `app.config`, so `mount()` is inert). Every runtime probe uses
  `typeof X === 'undefined' || X`, so an absent define means ON (vitest, third-party
  bundlers).

## Passes and output

The entry (`app/app.ts` or `app/app.js`) bundles to staged `dist/app.js` with linked
source maps and composed CSS, then public assets are copied. The three passes' options
come from `newBundleOptions`, `prerenderBundleOptions`, `staticPagesBundleOptions`, so
the static dev builder holds the identical passes open and bytes can't depend on the
driver.

- Production: ES2022, minified, console dropped unless `build.dropConsole: false`.
- **Per-page pass anchors `AbsWorkingDir`** to its output tree (unminified output carries
  `// <input path>` comments; otherwise a staging suffix leaks into `_puzzle/*.js`). The
  SPA pass must NOT anchor it — `metafileAllInputs` resolves against the process cwd, and
  dev CSS pruning would break when the app root isn't the cwd.
- Per-page source maps follow the `app.js` policy (dev linked, prod only under
  `build.sourceMap`), decided before esbuild runs, so chunk hashes describe shipped bytes.
- **Splitting** ([[DECISION-D160-SPA-CODE-SPLITTING]]): `build.splitting` gives the SPA
  pass `Splitting` + `ChunkNames: "chunks/[name]-[hash]"` — a per-pass flag only
  (esbuild rejects it with the prerender pass's `Outfile`; static mode forces it off since
  its `app.js` is deleted). The dev builder writes outputs itself under `Write: false` and
  deletes chunks the previous rebuild produced but this one didn't.
- D156: one-shot browser bundling and Tailwind overlap, with deterministic
  browser-before-Tailwind error order; styles compose after the browser pass fills its
  collector.
- **Staging and swap**: failure discards staging and keeps the last good dist; success
  renames old output aside, installs staging, removes the backup (inline for one-shot,
  backgrounded in dev). Path-containment guards every swap target. Transient dirs live
  under `<root>/.puzzle/tmp/` (`staging-*`, `dist-old-*`) — same filesystem, and the
  `.puzzle/.gitignore` of `*` hides leftovers from Tailwind v4's source walk (a stale
  `dist` copy turned a 112 ms scan into 14 s). `SweepWorkDirs` at build/dev start removes
  known-prefix real directories (also legacy `.dist-staging-*`/`dist.old-*`) older than
  ten minutes; a running build re-stamps its staging root every minute.
- Static/hybrid output runs a node-platform bundle and [[COMPONENT-SSG]] before the swap;
  a timeout or render failure keeps the last good dist and surfaces source-mapped errors.

## Incremental dev details (D156)

- The CSS collector has a monotonic revision (changes only on add/change/prune); the
  watch builder promotes the working collector to a committed snapshot only after full
  success, and Tailwind callbacks read the snapshot, so a partial esbuild pass can't leak
  CSS. Static dev promotes after the staging swap.
- Public-only batches mirror assets without rebuilding when the changed paths weren't
  inputs to the last metafile (both sides symlink-resolved).

## Public assets

From `app/public`, falling back to root `public`. Reserved generated names (`app.js`, its
map, `styles.css`, plus root `chunks/` under splitting) are rejected case-insensitively.
Staging copies are plain writes (and real copies, never hardlinks — prerender edits
staging's `index.html` in place); live-`dist/` copies are atomic and skip files matching
size + mtime (stamped from the source). The SPA mirror writes live: a mid-way I/O failure
can leave some assets updated, but its ownership set doesn't advance, so the next sync
retries. Full atomicity belongs to the staged pipelines.

## Config and resolution

- `puzzle.config.js` loads once through a bounded Node process; Go never parses JS.
  Optional scalars (`build.dropConsole`, `build.sourceMap`, `build.splitting`, `output`)
  go through `unset()`, which treats **JSON `null` as unset** — `json.Unmarshal` of
  `null` into a scalar is a silent no-op, so `dropConsole: null` would otherwise read as
  `false`.
- Aliases cover the root package and every subpath (`/adapter`, `/morph`,
  `/router-modes`, `/ssg`, `/static`, `/testing`, `/fixtures`) explicitly — the bare alias
  resolves to a file and can't take suffixes; longest key wins. `@/…` resolves from
  `app/` without capturing scoped packages. `PUZZLE_RUNTIME` overrides the in-repo walk
  and `node_modules`; a wrong value is a hard stop.
- Under `--fixtures`, a resolver plugin pins the wrapper's two imports `SideEffects: true`
  — the package declares `"sideEffects": false`, and esbuild would tree-shake both away.
