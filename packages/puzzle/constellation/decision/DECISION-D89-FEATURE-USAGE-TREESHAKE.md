---
status: verified
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
  - DECISION-D174-FUNCTION-LIBRARY
  - DECISION-D180-COMPONENT-SLOT
  - DECISION-D187-PASSIVE-CAPTURE
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
name: 'D89 — Pay-for-what-you-use runtime: a feature-usage scan drives DCE defines'
---

# D89 — Pay-for-what-you-use runtime: a feature-usage scan drives DCE defines

Runtime features an app provably doesn't use drop out of its bundle. One
pre-bundle usage scan (`ScanUsage`, `compiler/internal/plugin/scan.go`) sets
literal esbuild defines, and every runtime site that holds a gated import alive
is guarded by them. The same scan feeds the function manifest (D31).

## Gates

| define | keeps | set when |
|---|---|---|
| `__PUZZLE_HAS_FLIP__` | `views/flip.js` (D85) | a `flip` attr on an element, component invocation or slot child |
| `__PUZZLE_HAS_PORTAL__` | `views/portal.js` (D144) | any `<Portal>` (not inside a raw block) |
| `__PUZZLE_HAS_SNIPPETS__` | snippet partition/stamping (D166) | any `<Snippet>`, or a `<Slot>`/`<Children>` with arguments |
| `__PUZZLE_HAS_COMPONENT_SLOT__` | `views/componentSlot.js` (D180) | any `<Component>` |
| `__PUZZLE_HAS_CONDITIONAL_SLOT__` | outlet parking/reattach in ViewManager, PuzzleView, router (D30) | over-inclusive: a plain marker under `{#if}`/`{#case}`/`{#for}`, in a snippet body, marker fallback, skeleton or `<Component>`, or under a node carrying `key` or a `{...spread}` |
| `__PUZZLE_HAS_LISTENER_OPTIONS__` | the native listener-options branch (D187) | a `passive` or `capture` modifier |
| `__PUZZLE_HAS_RAW_AT__` | the D150 literal-`@` attribute shim | over-inclusive: any `{#raw}` block |
| `__PUZZLE_HAS_RAW_HTML__` / `__PUZZLE_HAS_RAW_SANITIZE__` | live-HTML node / sanitizer (D174) | a text interpolation whose outermost call is `raw` or `newline_to_br`; only `raw` keeps the sanitizer |
| `__PUZZLE_HAS_LAZY__` | `router/lazy.js` (D163) | over-inclusive; the one **script** fact (below) |

`__PUZZLE_HAS_I18N__` and `__PUZZLE_HAS_LOCALE_ROUTING__` use the same probe
shape but are **config** facts (D175, D177), not scan results: script code can
call `ctx.i18n` where no template scan sees it.

**Lazy detection** reads `.js/.mjs/.cjs/.jsx/.ts/.mts/.cts/.tsx` as text (the
compiler never parses script bodies) plus whole `.pzl` sources. Any of three
regex rules sets the bit: a `lazy(`-shaped call; a `lazy` specifier in an
`import`/`export … from '@magic-spells/puzzle'` clause (catches renames); or a
whole-namespace import/re-export of the package (catches destructuring off the
namespace). Rules match structure, never the bare word.

## What the scan reads

Two walks feed one `Usage`:

- **Project walk:** `.pzl` and script files across the whole project root (not
  just `app/`). Prunes `node_modules` and dot-directories at any depth,
  `dist`/`build`/`vendor` only directly under the root.
- **Package walk** (`plugin/scanpkg.go`): the `.pzl` files of installed packages
  whose `package.json` lists `@magic-spells/puzzle` in `peerDependencies` or
  `dependencies`. Puzzle itself and apps (the scan root, or a directory outside
  every `node_modules` holding a `puzzle.config.js`) never count. It searches
  the `node_modules` under the root and each ancestor, every package's nested
  `node_modules`, and the one beside a linked package's real directory; visits
  by real path; reads one manifest per package root and nothing else of an
  uncounted package. In a counted package it reads **`.pzl` only** (no lazy
  match — the lazy bit is an app route-table fact), skips root-level
  `example(s)/`, `test(s)/`, `__tests__/`, and does not prune `dist/` (packages
  publish `.pzl` there).
- **Pre-compiled component JavaScript is unsupported input.** A component
  package must ship `.pzl` source and declare Puzzle.

**The per-file check** (`plugin/usagecheck.go`) catches what both walks miss.
The `.pzl` OnLoad records the usage of every compiled `.pzl` the scan did not
read (`Usage.PZLFiles` lists those it did), keyed by path so the record
survives esbuild's OnLoad cache; an OnEnd callback fails the pass when a
recorded file needs a gate that is off or a function the manifest lacks. The
error names the file and features and says how to fix it: declare Puzzle in
`peerDependencies`, move the file out of a pruned directory, or restart a
running `puzzle dev` after a package change. Records are filtered per pass by
the metafile graph. `lazy()` is not checked (the text match would fail builds
over a template that only mentions the word). A plugin with no `Usage` (focused
callers) runs no check.

## Rules

- **Probes are inlined, never abstracted.** Every gated site writes
  `typeof __PUZZLE_HAS_X__ === 'undefined' || __PUZZLE_HAS_X__` in full —
  esbuild does not constant-propagate a named const or helper. Undefined means
  feature-on, so vitest, unbundled consumers and foreign bundlers keep full
  behavior.
- **Probe only what holds an import alive** (flip: just the `beginFlip` and
  `playFlip` calls). Where a runtime property precedes the import
  (`entry.hasLazy`), the probe must lead the expression.
- Module splits follow the gates: `validateRouteView` lives in `router.js` and
  class-shape helpers in `router/viewClass.js`, so validation never pins
  `lazy.js`.
- **A false bit degrades safely** for vnodes no `.pzl` compile produced: Portal
  renders an inert comment and warns in dev; a stray `flip` warns once in dev;
  the lazy validator says "lazy() support was compiled out". A metadata vnode
  tag (`#snippet`, …) reaching element creation or the SSG serializer throws
  `metadataTagError` in every build; the long text is dev-only.
- **Scan policy:** fail-soft and over-inclusive — unreadable or unparseable
  files and malformed manifests are skipped. The per-file check, not the scan,
  fails builds.
- **Defines are recomputed every pass** (one-shot, watch/dev, prerender, static
  per-page). esbuild freezes `Define` at context creation, so long-lived
  builders compare the whole `Features` struct and replace the context when a
  bit flips. `plugin.IsScanInput` is the single predicate for "can this file
  move a bit", shared by the walk and `build.pathsHaveScanInput` — widen the
  scan only there. The dev scanner memoizes per file (path + mtime + size) and
  watches the project only, so a package install needs a dev restart.
- **Dev/prod message split:** long diagnostics sit behind the inline
  `__PUZZLE_DEV__` probe. Dev-only Store schema assertions are a module function
  (`assertSchemaNames`), because esbuild never removes class members.
- **Bundle assertions use string literals**, never identifiers (minification
  mangles names): `cubic-bezier(0.2, 0, 0, 1)`, `data-puzzle-portal`, `@@`,
  `lazy() loader must return a promise`.

## Alternatives rejected

- **A virtual features manifest (D31's shape)** — each feature is one boolean.
- **`puzzle.config.js` feature flags** — users must know them; a miss is silent
  bloat or breakage.
- **Scanning all of `node_modules`** — thousands of packages, plus test
  fixtures and runtime JS that would trip the lazy regex.
- **Scanning packages' scripts** — the lazy bit lives in the app.
- **Deciding defines from OnLoad (learn in one pass, bundle in a second)** —
  doubles bundle cost; defines must be fixed before a pass.
- **Erroring inside OnLoad** — cached OnLoad results would leave the error
  stale when the app's own usage later flips the bit.
- **Gating `animate.js`/`visibility.js`** — specs live in opaque script and the
  call sites are hot; about 1 KB.
- **A scan for managed head tags** — English-word false positives; head tags
  are build-time only (D84).

## Consequences

- The compiler encodes runtime module boundaries: refactoring a gated module
  must keep `ScanUsage`, the per-file check's feature list (`usagecheck.go`),
  `bundleDefines` and every probe in sync, or a feature silently vanishes.
- Three exclusion mechanisms exist (subpath export, define+DCE, virtual
  manifest). Resist a fourth; new features use define+DCE.
