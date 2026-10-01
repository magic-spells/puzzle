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
  - DECISION-D174-STANDARD-FORMATTERS
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
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
- A false bit degrades safely: Portal renders an inert comment and warns in dev;
  a `flip` seen at runtime with the gate off warns once in dev; the lazy
  validator's message gains "lazy() support was compiled out".
- **Scan policy** (D31's): fail-soft and over-inclusive; unreadable files are
  skipped; `node_modules`/`dist`/`build`/`vendor`/dot-dirs are pruned. So
  **pre-compiled component packages are unsupported input** — pieces ship as
  source the app compiles. A metadata vnode tag (starting with `#`, e.g.
  `#snippet`) reaching element creation or the SSG serializer throws
  `metadataTagError` in every build; the long explanation is dev-only.
- **Defines are recomputed for every pass** (one-shot, watch/dev, prerender,
  static per-page); dev takes the scan's answer too. esbuild freezes `Define` at
  context creation, so long-lived builders compare the whole `Features` struct
  and replace the context when any bit flips. `plugin.IsScanInput` is the single
  predicate for "can this changed file move a bit" — used by the walk and by
  `build.pathsHaveScanInput`. Widen what the scanner reads only there. The dev
  scanner memoizes per file (path + mtime + size).
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
- **Gating `animate.js`/`visibility.js`** — declined: specs live in opaque
  script, and call sites are hot; ~1 KB.
- **Gating `@event:outside`** — deferred: inline branches, not a module.
- **A build-time scan for managed head tags** — removed: English-word false
  positives and a missed `title` case; head tags are build-time only (D84).
- **Bundle-size budgets in CI** — declined for now.

## Consequences

- The compiler encodes runtime module boundaries: refactoring any gated module
  must keep `ScanUsage` and every probe in sync, or a feature silently vanishes.
- Three exclusion mechanisms exist (subpath export, define+DCE, virtual
  manifest). Resist a fourth; new features use define+DCE.
