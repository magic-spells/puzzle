---
status: built
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - DECISION-D31-FORMATTER-TREESHAKE
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D85-FLIP-ATTRIBUTE
  - DECISION-D144-PORTAL
  - DECISION-D150-RAW-TEMPLATE-BLOCK
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D166-SNIPPETS
  - DECISION-D174-STANDARD-FORMATTERS
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
  - FEATURE-SCAN-PACKAGE-PZL
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
name: 'D89 — pay-for-what-you-use runtime: feature-usage scan drives DCE defines'
---

# D89 — Pay-for-what-you-use runtime: a feature-usage scan drives DCE defines

Runtime features an app provably doesn't use drop out of its bundle: one
build-time usage scan (`ScanUsage`, `compiler/internal/plugin/scan.go`) sets
literal esbuild defines, and every import-holding runtime site is guarded by
them. This extends D31's per-app scan and D57's define+DCE mechanism.

## Gates

| define | feature | signal |
|---|---|---|
| `__PUZZLE_HAS_FLIP__` | `views/flip.js` (D85) | exact: a `flip` attr on elements, **component props** (a component vnode's props are its attrs) and slot children |
| `__PUZZLE_HAS_PORTAL__` | `views/portal.js` (D144) | exact: any `*parser.Portal` node; `<Portal>` inside a raw block doesn't count |
| `__PUZZLE_HAS_SNIPPETS__` | snippet partition/stamping + diagnostics (D166) | exact: any `*parser.Snippet` or args-bearing `<Slot>`/`<Children>` |
| `__PUZZLE_HAS_RAW_AT__` | the D150 literal-`@` attribute shim | over-inclusive: any `{#raw}` block |
| `__PUZZLE_HAS_RAW_HTML__` / `__PUZZLE_HAS_RAW_SANITIZE__` | live-HTML node / sanitizer (D174) | a text interpolation whose outermost call is `raw` or `newline_to_br`; only `raw` keeps the sanitizer |
| `__PUZZLE_HAS_LAZY__` | `router/lazy.js` (D163) | over-inclusive, the one **script** fact (below) |

**Lazy detection** reads `.js/.mjs/.cjs/.jsx/.ts/.mts/.cts/.tsx` as text (the
compiler never parses script bodies) alongside `.pzl` source, which is matched
before the template parse so a rejected `.pzl` still contributes. Any of three
regex rules sets the bit: a `lazy(`-shaped call; a `lazy` specifier in an
`import`/`export … from '@magic-spells/puzzle'` clause (catches renames); or a
whole-namespace import/re-export from the package (catches destructuring off
the namespace). Rules match structure, never a bare English word.

## What the scan reads

Two walks feed one `Usage`, so functions from either reach the formatter
manifest and either can turn a gate on:

- **The project walk** reads `.pzl` and script files across the whole project
  root (not just `app/`). It prunes `node_modules` and dot-directories at any
  depth, and `dist`/`build`/`vendor` only directly under the root.
- **The package walk** (`plugin/scanpkg.go`) reads the `.pzl` files of
  installed packages whose `package.json` lists `@magic-spells/puzzle` in
  `peerDependencies` or `dependencies` (Puzzle itself excluded). It visits the
  `node_modules` under the scan root and under each ancestor (node's own
  search path), scoped and unscoped top-level entries, the nested
  `node_modules` of a counted package, and the `node_modules` that holds a
  counted package's real directory (a store layout keeps a package's
  dependencies beside it). It reads only `package.json` at each package root
  and never descends into an uncounted package. In a counted package it reads
  **`.pzl` files only** — no script scanning, so runtime-like package
  JavaScript cannot set `__PUZZLE_HAS_LAZY__`. Directories are visited by real
  path, so a linked package is read once. Package manifests are memoized by
  stamp like files.
- **Pre-compiled component packages are unsupported input.** Only `.pzl`
  source is scanned; a package must ship its `.pzl` files and declare Puzzle.

**The per-file check** (`plugin/usagecheck.go`) covers what both walks miss.
The `.pzl` OnLoad records the usage of every compiled `.pzl` the scan did not
read (`Usage.PZLFiles` lists the ones it did), keyed by path so the record
survives esbuild's cached OnLoad. An OnEnd callback then fails the pass when a
recorded file needs a gate that is off or a library function the manifest
lacks. The error names the file and the features, says to add
`@magic-spells/puzzle` to the package's `peerDependencies` (or, outside
`node_modules`, to move the file where the walk reads it), and says a running
`puzzle dev` needs a restart after a package changes. Records leave with the
import: each pass filters them by its metafile graph. `lazy()` is not checked,
because it is an app route-table fact, and the text match would fail builds
over a template that only mentions the word. A plugin that never received a
`Usage` (focused callers) runs no check.

## Rules

- **Probes are inlined, never abstracted.** Every site that references a gated
  import writes `typeof __PUZZLE_HAS_X__ === 'undefined' || __PUZZLE_HAS_X__` in
  full — esbuild does not constant-propagate a named const or helper. Undefined
  means feature-on, so vitest, unbundled consumers and foreign bundlers keep full
  behavior.
- **Probe only what holds an import alive** (e.g. flip: just the `beginFlip` and
  `playFlip` calls). Where a runtime property precedes the import
  (`entry.hasLazy`), the probe must lead the expression.
- Module splits follow the gates: `validateRouteView` lives in `router.js` and
  shared class-shape helpers in `router/viewClass.js`, so validation never pins
  `lazy.js`.
- A false bit degrades safely for vnodes no `.pzl` compile produced
  (pre-compiled JavaScript): Portal renders an inert comment and warns in dev;
  a `flip` seen at runtime with the gate off warns once in dev; the lazy
  validator's message gains "lazy() support was compiled out". A metadata vnode
  tag (starting with `#`, e.g. `#snippet`) reaching element creation or the SSG
  serializer throws `metadataTagError` in every build; the long explanation is
  dev-only.
- **Scan policy** (D31's): fail-soft and over-inclusive; unreadable or
  unparseable files and malformed manifests are skipped, never fatal. The
  per-file check, not the scan, is what fails a build.
- **Defines are recomputed for every pass** (one-shot, watch/dev, prerender,
  static per-page); dev takes the scan's answer too. esbuild freezes `Define` at
  context creation, so long-lived builders compare the whole `Features` struct
  and replace the context when any bit flips. `plugin.IsScanInput` is the single
  predicate for "can this changed file move a bit" — used by the project walk
  and by `build.pathsHaveScanInput`. Widen what the scanner reads only there.
  The dev watcher stays on the project, so a package install or manifest edit
  needs a dev restart. The dev scanner memoizes per file (path + mtime + size).
- **Dev/prod message split:** long diagnostics (metadata tags, route-table config
  errors, warn-once helpers) are built behind the inline `__PUZZLE_DEV__` probe;
  production keeps the short diagnosis. Dev-only Store schema assertions are a
  module function, because esbuild never removes class members.
- **Bundle assertions use string literals**, never identifiers (minification
  mangles names): `cubic-bezier(0.2, 0, 0, 1)`, `data-puzzle-portal`, `@@`,
  `lazy() loader must return a promise`.

## Alternatives

- **A virtual features manifest (D31's shape)** — rejected: each feature is one
  boolean; nothing to enumerate.
- **`puzzle.config.js` feature flags** — rejected: users must know them; a miss
  is silent bloat or breakage.
- **Scanning all of `node_modules`** — rejected: thousands of packages, and
  packages ship test fixtures and runtime JavaScript that would trip the lazy
  regex. The `package.json` declaration is one cheap read per package root.
- **Scanning packages' scripts too** — rejected: the lazy bit is a route-table
  fact that lives in the app.
- **Deciding the defines from OnLoad (one pass learns, a second pass bundles)**
  — rejected: it doubles the bundle cost, and defines must be fixed before a
  pass. The scan stays pre-bundle, and the check only verifies it.
- **Erroring inside OnLoad** — rejected: an incremental context caches OnLoad
  results, so the error would go stale when the app's own usage later turned
  the feature on or off. The check runs after each pass over persisted records.
- **Gating `animate.js`/`visibility.js`** — declined: specs live in opaque
  script, and call sites are hot; ~1 KB.
- **Gating `@event:outside`** — deferred: inline branches, not a module.
- **A build-time scan for managed head tags** — removed: English-word false
  positives and a missed `title` case; head tags are build-time only (D84).
- **Bundle-size budgets in CI** — declined for now.

## Consequences

- The compiler encodes runtime module boundaries: refactoring any gated module
  must keep `ScanUsage`, the per-file check's feature list, and every probe in
  sync, or a feature silently vanishes.
- Component packages that ship `.pzl` source work when they declare Puzzle as a
  peer dependency; one that doesn't is a build error, not a production crash.
- The package walk reads one `package.json` per top-level package on every
  scan (memoized by stamp in dev); counted packages are walked in full.
- Three exclusion mechanisms exist (subpath export, define+DCE, virtual
  manifest). Resist a fourth; new features use define+DCE.
