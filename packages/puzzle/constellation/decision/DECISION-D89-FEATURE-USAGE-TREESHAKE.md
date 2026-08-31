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
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Verified at 1400ec6 (post-merge, PR #21): ScanUsage/hasFlipAttr(node.Props) in
      compiler/internal/plugin/scan.go, syncTitle/syncTags split across head.js/headTags.js, 2
      inlined __PUZZLE_HAS_FLIP__ probes in viewManager.js (post probe-reduction commit) all
      confirmed present. 1016 vitest + full Go suite green; todos/music drop both modules, blog
      retains flip.js, static-docs retains head tags across 5 prerendered pages.
    sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: decision
    text: >-
      Compiled component packages are NOT a supported input for the usage gate (2026-08-30). The
      scan reads first-party .pzl source and prunes node_modules, so a PRE-COMPILED component
      package emitting `new ViewNode('#snippet', …)` can hand a snippet vnode to an app whose
      `__PUZZLE_HAS_SNIPPETS__` is false — nothing partitions it out, a `<Children>`/`<Slot>`
      substitution forwards it into the live tree, and generic mounting called
      `document.createElement('#snippet')` → DOM InvalidCharacterError (blank position / errorView),
      while the SSG serializer swallowed it as ''. The boundary is deliberate and the same one
      flip/Portal/raw have always had: pieces ship as copied SOURCE that the app's own build
      compiles, so the scan sees them. We do NOT scan node_modules and do NOT stop tree-shaking.
      What changed is the failure mode: `metadataTagError(tag)` in views/ViewNode.js is thrown by
      both the browser element-creation path and ssg/serialize.js for any vnode tag starting with
      '#' (the arity placeholder '#' returns earlier on both paths), naming the metadata tag, the
      false define, and the compiled-package boundary. The check is a bare `startsWith('#')` on a
      string already in hand and sits OUTSIDE every gate, so it holds in every build; only the
      message is built, on the throw path. Regression: tests/snippet-tag-escape.test.js.
name: 'D89 — pay-for-what-you-use runtime: feature-usage scan drives DCE defines'
---

# D89 — pay-for-what-you-use runtime: feature-usage scan drives DCE defines

Runtime features an app can prove it does not use disappear from its bundle, via
one build-time usage scan and literal esbuild defines. The active gates are
`__PUZZLE_HAS_FLIP__`, `__PUZZLE_HAS_PORTAL__`, `__PUZZLE_HAS_RAW_AT__`,
`__PUZZLE_HAS_SNIPPETS__`, and `__PUZZLE_HAS_LAZY__`; the former
managed-head gate was retired by D111. Four are template facts; lazy is a
script fact, which is why the scan
reads the app's `.js`/`.ts` modules as well as its `.pzl` files.
This generalizes [[DECISION-D31-FORMATTER-TREESHAKE]]'s per-app inclusion
discipline from formatters to runtime feature seams, using
[[DECISION-D57-HMR-STATE-RELOAD]]'s define+DCE mechanism.

## Context

The todos bundle roughly doubled (11.3 → 20.9 KB gzip) over two weeks of feature work. A sourcemap teardown attributed ~97% of the growth to the framework runtime, not app code — and several modules were unconditional imports that most apps never exercise. The framework already had three exclusion mechanisms (D31's virtual formatter manifest; the `./morph` subpath export nobody imports unless opting in; D57's `__PUZZLE_DEV__` define + DCE for devstate). This adds no fourth concept — it extends D57's define mechanism, fed by D31's scan infrastructure.

## Decision

**Runtime — `head.js` splits on a real seam.** `head.js` keeps the always-present core (`resolveHead`, `resolveField`, `HEAD_FIELDS`, and a new one-line `syncTitle`); the tag machinery (`MANAGED_TAGS`, `syncTags`, `setTagValue`) moves to `headTags.js`. The router calls `syncTitle` unconditionally and `syncTags` behind the gate. This split is justified independently of bundle size: it separates a pure resolver from a DOM mutator, and stops title-only apps running ~10 no-op `querySelector` probes on every navigation.

**Runtime — guard probes are inlined, never abstracted.** Every site that REFERENCES a gated import writes the full `typeof __PUZZLE_HAS_X__ === 'undefined' || __PUZZLE_HAS_X__` expression. A named module const or arrow helper is **NOT** constant-propagated by esbuild — verified empirically: with a named const, `var t=!1` survived and the guarded calls kept `flip.js` alive. Only the inlined form folds. Undefined ⇒ probe is true, so vitest, unbundled consumers, and foreign bundlers keep full behavior with no compiler.

Probe only what holds an import alive. In `patchKeyedChildren` that is exactly two sites — the `beginFlip` and `playFlip` calls. The `'flip' in newChild.attrs` detection is deliberately left bare: it references no import, so gating it buys no tree-shaking, only skipping one `in` check per child — the same check that already ran before this decision. Probes are verbose and sit in hot loops, so each one must earn its place by dropping bytes.

Portal follows the same rule at every reference imported from `views/portal.js`:
the app/static host setup and teardown plus ViewManager mount, patch, unmount,
aborted-release, subtree-release, and logical-containment calls all carry the
full inline probe. With the bit false a Portal vnode occupies only an inert
local comment, warns once in development, and never crashes production.
`portalAwareContains` is bypassed in favor of plain `el.contains`.

The D150 literal-`@` attribute shim is inline rather than a module, but both
`startsWith('@@')` branches and the sole `setLiteralAtAttr` reference use the
full `__PUZZLE_HAS_RAW_AT__` probe so minification can delete the shim and its
distinctive strings together.

`__PUZZLE_HAS_LAZY__` gates [[DECISION-D163-LAZY-ROUTE-VIEWS]]'s resolver
(`router/lazy.js`). Only three router sites reference that module — the
route-compile `hasLazyRouteViews`, the navigation-path `resolveRouteViews`, and
the route-table validator's `isLazyView` check — and all three carry the full
inline probe. The navigate site's probe must LEAD its `entry.hasLazy` test:
`hasLazy` is a runtime property esbuild cannot fold, so without the probe that
one reference would pin the module into every bundle. Gating this feature
forced a small module split, and the split is the durable part: route-view
validation runs in every app, lazy or not, so `validateRouteView` lives in
`router.js` and the class-shape helpers it shares with the resolver live in
`router/viewClass.js`. Routing validation through the resolver module would
have re-pinned `lazy.js` and defeated the gate.

**Compiler — one scan, two signal qualities.** `ScanFormatters` generalizes to `ScanUsage`, keeping D31's fail-soft, over-inclusive policy (unreadable/unparseable files skipped; `node_modules`/`dist`/`build`/`vendor`/dot-dirs pruned):

- **flip — exact.** AST match on a `flip` attribute across element attrs, component props, and slot children. Component props are load-bearing: a component vnode's props *are* its attrs (`ViewNode` `get props()`), so the keyed patcher's `'flip' in newChild.attrs` fires for `<PostCard … flip>`. The first implementation checked elements only, which emitted `HAS_FLIP=false` for `examples/blog` and silently killed its animation — the false negative this scan must never produce. Guarded by `TestScanUsageFlipOnComponent`.
  The pruning list creates a structural asymmetry worth naming: a `flip` attr arriving from an INSTALLED `.pzl` component (node_modules is pruned) degrades SILENTLY — no animation, nothing else — while the formatter half of the same scan degrades LOUDLY (D43's `[puzzle] unknown formatter` console.error + pass-through). That asymmetry is exactly why flip needs `TestScanUsageFlipOnComponent` and formatters don't. Since the D118 round, the runtime closes the gap with a dev-only, once-per-session warning when a `flip` attr is present at patch time while `__PUZZLE_HAS_FLIP__` is defined false.
- **Portal — exact.** Any `*parser.Portal` node sets `HasPortal`; its children
  still recurse for the other usage facts. Raw-block sample markup named
  `<Portal>` parses as an ordinary element and does not set the bit.
- **snippets — exact.** Any `*parser.Snippet` node or args-bearing
  Slot/Children marker sets `HasSnippets`; the gate covers snippet
  partition/stamping plus its development diagnostics.
- **raw `@` attributes — deliberately over-inclusive.** Any parsed `{#raw}`
  block in the template or skeleton sets `HasRawAt`, even when its body has no
  `@`-prefixed attribute. A false positive costs only the small shim; a false
  negative would route an authored `@x` name to `setAttribute` and throw.
- **lazy — deliberately over-inclusive, and the one SCRIPT-level bit.**
  `lazy()` is called from `routes.js`, never from a template, so the walk reads
  `.js`/`.mjs`/`.cjs`/`.jsx`/`.ts`/`.mts`/`.cts`/`.tsx` files as TEXT alongside
  the `.pzl` files it parses. Two independent regex rules each suffice: a
  `lazy(`-shaped call anywhere in the file, or a `lazy` specifier inside an
  `import`/`export … from '@magic-spells/puzzle'` clause. The second rule exists
  for the renamed binding (`import { lazy as page }`), which no call-shape match
  can see. A `.pzl` runs the same text match over its whole source before the
  split, so a `lazy()` call in a `<script>` section counts — and it runs BEFORE
  the template parse, so a `.pzl` the parser rejects still contributes the bit
  rather than losing it to the fail-soft path. Detection is regex-level on
  purpose: the compiler never parses script bodies (a public invariant), and the
  cost asymmetry is the scan's usual one.
- **head tags — RETIRED, see [[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]].** This half of the scan no longer exists. It was a raw substring scan of `.js`/`.ts`/`.pzl` for `description`/`canonical`/`socialImage`, and it was wrong in both directions: it never probed `title`, so a title-only hybrid app stranded the SSG's `og:title` un-updatable (a real shipped bug), while `description` as an ordinary English word turned the bit on for apps emitting no managed tags at all. D111 deleted the runtime `syncTags` outright rather than keep guessing when to ship it. With no browser importer left, ordinary tree-shaking handles it and no define is needed. Note that reading `.js`/`.ts` at all is back — for lazy, above — but on a different footing: a lazy false positive costs one small module, whereas the head-tag scan's false positives shipped a whole DOM-mutating table on the strength of an English word.

Defines are recomputed for one-shot, watch/dev, prerender, and per-page static bundles. Dev builds do NOT force any bit on — they take the scan's answer like every other pass. esbuild **freezes `Define` when a context is created**, so each long-lived builder compares the complete `Features` value and replaces its context when any bit flips — otherwise a mid-session edit adding or removing flip, Portal, raw, snippets, or lazy usage would build against stale defines while the incremental graph stayed warm. The dev scanner's per-file memo (path + mtime + size) covers the script files too, so reading them adds no per-rebuild parse cost.

**What kind of file can move a bit is a THIRD place that must agree, and it is
the one that has already been wrong.** The static dev builder re-scans on every
rebuild, but the SPA `WatchBuilder` re-scans only when the changed set holds a
file the walk actually reads — a real optimization, and a trap. That predicate
tested for `.pzl` alone, which was right while every bit was a template fact and
silently wrong the moment lazy arrived: a developer adding their first `lazy()`
to `routes.js` mid-session kept rebuilding against a frozen
`__PUZZLE_HAS_LAZY__ = false` and hit the compiled-out route-view throw until
they touched an unrelated template or restarted `puzzle dev`. The fix is
structural, not a second list: `plugin.IsScanInput` is the single predicate, the
walk and `build.pathsHaveScanInput` both call it, and
`TestWatchBuilderReplacesContextWhenUsageDefinesFlip` now drives a `.js` edit
through the builder in both directions. Any future widening of what the scanner
reads goes in that one function.

## Alternatives rejected

- **A virtual "features manifest" module** (D31's exact shape) — defines are simpler here: each feature is one boolean, not a name subset, so there is nothing to enumerate into a module.
- **`puzzle.config.js` feature flags** — explicit and precise, but users must know the flags exist; forgetting one means silent bloat (default-on) or silent breakage (default-off). The scan needs no user action.
- **Gating `animate.js` / `visibility.js`** — declined. Animation specs are an `animations` class field in the opaque `<script>` body, so detection would need the same weak token scan, and the call sites sit on the per-mount hot path. Not worth the churn for ~1 KB; both stay unconditional.
- **Gating the `@event:outside` modifier (D86)** — deferred. Template-detectable and cheap to scan, but it is inline branches in `viewManager`, not a droppable module; a few hundred bytes against edits to delicate listener teardown.
- **A named const / helper for the probe** — does not tree-shake (see Decision).
- **Keeping `validateRouteView` in `lazy.js` and gating only the resolver
  calls** — rejected. esbuild tree-shakes per declaration, so that would have
  stripped the resolver half but kept the validator, the marker WeakMap, and
  their helpers in every bundle — roughly a third of the module, for a function
  that has nothing lazy-specific about it in a lazy-free app.
- **Bundle-size regression budgets in CI** — considered and declined for now; the team preferred no added gate.

## Consequences

Apps pay only for the features they use. On the Portal/raw-gate branch,
`examples/todos` moves from the `feat/error-view` baseline of **79,553 raw /
25,338 gzip-9** to **77,809 raw / 24,739 gzip-9**: **1,744 raw / 599 gzip**
saved. `examples/overlays` sets `HasPortal` and its production bundle retains
`data-puzzle-portal`. Existing flip users continue to retain `flip.js`.

The lazy gate saves a comparable slice on the 0.7.0 line: `examples/todos`
25,446 → 24,868 gzip-9 (**578 bytes**), `examples/hello-world` 22,389 → 21,831
(**558 bytes**). `examples/blog`, which uses `lazy()`, is unchanged (+1 byte).

Three costs are accepted and should be re-examined if they bite:

1. **The raw-block signal is intentionally broader than the shim's actual
   need.** A raw block with no literal `@` attribute still retains the shim.
   This is the safe direction: over-inclusion costs bytes, while under-inclusion
   can throw at runtime.
2. **The compiler now encodes runtime module boundaries.** Refactors of flip,
   Portal, the raw-attribute shim, snippets, or the lazy resolver must keep `ScanUsage` and every import-holding
   probe in sync or a feature silently vanishes. Mitigations: every probe
   defaults to feature-ON when its define is absent, and coverage exists at both
   scan and production-bundle levels.
3. **The scan now reads every app script, not just templates.** Cost is one
   file read per `.js`/`.ts` module per cold scan, memoized by stamp for dev
   rebuilds. It also re-opens the door D111 closed on grepping script text —
   which is why the lazy rules match structure (a call shape, an import clause
   naming the framework) rather than a bare English word.

**Bundle assertions must use string literals, never identifiers.** Minification
mangles function names, so asserting identifier absence passes vacuously.
Coverage uses `cubic-bezier(0.2, 0, 0, 1)`, `data-puzzle-portal`, `@@`, and the
resolver-only throw text `lazy() loader must return a promise` — distinctive
literals that survive minification. The lazy gate additionally asserts a
PRESENCE: with the define false, `validateRouteView`'s message gains a
"lazy() support was compiled out" suffix, so a marker smuggled in from an
unscanned package fails loudly at route-compile time instead of mounting as
though it were a view class.

The framework now carries three exclusion mechanisms (subpath export, define+DCE, virtual manifest). That is a conceptual ceiling worth respecting — a fourth should be resisted; new features should reach for the define+DCE gate established here.
