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
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-08-16T04:34:35.786Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
notes:
  - kind: verified
    text: >-
      Verified at 1400ec6 (post-merge, PR #21): ScanUsage/hasFlipAttr(node.Props) in
      compiler/internal/plugin/scan.go, syncTitle/syncTags split across head.js/headTags.js, 2
      inlined __PUZZLE_HAS_FLIP__ probes in viewManager.js (post probe-reduction commit) all
      confirmed present. 1016 vitest + full Go suite green; todos/music drop both modules, blog
      retains flip.js, static-docs retains head tags across 5 prerendered pages.
    sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
name: 'D89 — pay-for-what-you-use runtime: feature-usage scan drives DCE defines'
---

# D89 — pay-for-what-you-use runtime: feature-usage scan drives DCE defines

Runtime features that are exact template facts use one build-time usage scan and
literal esbuild defines to disappear when unused. The active gates are
`__PUZZLE_HAS_FLIP__`, `__PUZZLE_HAS_PORTAL__`, and
`__PUZZLE_HAS_RAW_AT__`; the former managed-head gate was retired by D111.
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

**Compiler — one scan, two signal qualities.** `ScanFormatters` generalizes to `ScanUsage`, keeping D31's fail-soft, over-inclusive policy (unreadable/unparseable files skipped; `node_modules`/`dist`/`build`/`vendor`/dot-dirs pruned):

- **flip — exact.** AST match on a `flip` attribute across element attrs, component props, and slot children. Component props are load-bearing: a component vnode's props *are* its attrs (`ViewNode` `get props()`), so the keyed patcher's `'flip' in newChild.attrs` fires for `<PostCard … flip>`. The first implementation checked elements only, which emitted `HAS_FLIP=false` for `examples/blog` and silently killed its animation — the false negative this scan must never produce. Guarded by `TestScanUsageFlipOnComponent`.
  The pruning list creates a structural asymmetry worth naming: a `flip` attr arriving from an INSTALLED `.pzl` component (node_modules is pruned) degrades SILENTLY — no animation, nothing else — while the formatter half of the same scan degrades LOUDLY (D43's `[puzzle] unknown formatter` console.error + pass-through). That asymmetry is exactly why flip needs `TestScanUsageFlipOnComponent` and formatters don't. Since the D118 round, the runtime closes the gap with a dev-only, once-per-session warning when a `flip` attr is present at patch time while `__PUZZLE_HAS_FLIP__` is defined false.
- **Portal — exact.** Any `*parser.Portal` node sets `HasPortal`; its children
  still recurse for the other usage facts. Raw-block sample markup named
  `<Portal>` parses as an ordinary element and does not set the bit.
- **raw `@` attributes — deliberately over-inclusive.** Any parsed `{#raw}`
  block in the template or skeleton sets `HasRawAt`, even when its body has no
  `@`-prefixed attribute. A false positive costs only the small shim; a false
  negative would route an authored `@x` name to `setAttribute` and throw.
- **head tags — RETIRED, see [[DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY]].** This half of the scan no longer exists. It was a raw substring scan of `.js`/`.ts`/`.pzl` for `description`/`canonical`/`socialImage`, and it was wrong in both directions: it never probed `title`, so a title-only hybrid app stranded the SSG's `og:title` un-updatable (a real shipped bug), while `description` as an ordinary English word turned the bit on for apps emitting no managed tags at all. D111 deleted the runtime `syncTags` outright rather than keep guessing when to ship it. With no browser importer left, ordinary tree-shaking handles it and no define is needed. `ScanUsage` now reads only `.pzl` files — the head-tag grep was its sole reason to ever open a `.js`/`.ts`.

Defines are recomputed for one-shot, watch/dev, prerender, and per-page static bundles. esbuild **freezes `Define` when a context is created**, so each long-lived builder compares the complete `Features` value and replaces its context when any bit flips — otherwise a mid-session edit adding or removing flip, Portal, or raw usage would build against stale defines while the incremental graph stayed warm.

## Alternatives rejected

- **A virtual "features manifest" module** (D31's exact shape) — defines are simpler here: each feature is one boolean, not a name subset, so there is nothing to enumerate into a module.
- **`puzzle.config.js` feature flags** — explicit and precise, but users must know the flags exist; forgetting one means silent bloat (default-on) or silent breakage (default-off). The scan needs no user action.
- **Gating `animate.js` / `visibility.js`** — declined. Animation specs are an `animations` class field in the opaque `<script>` body, so detection would need the same weak token scan, and the call sites sit on the per-mount hot path. Not worth the churn for ~1 KB; both stay unconditional.
- **Gating the `@event:outside` modifier (D86)** — deferred. Template-detectable and cheap to scan, but it is inline branches in `viewManager`, not a droppable module; a few hundred bytes against edits to delicate listener teardown.
- **A named const / helper for the probe** — does not tree-shake (see Decision).
- **Bundle-size regression budgets in CI** — considered and declined for now; the team preferred no added gate.

## Consequences

Apps pay only for the features they use. On the Portal/raw-gate branch,
`examples/todos` moves from the `feat/error-view` baseline of **79,553 raw /
25,338 gzip-9** to **77,809 raw / 24,739 gzip-9**: **1,744 raw / 599 gzip**
saved. `examples/overlays` sets `HasPortal` and its production bundle retains
`data-puzzle-portal`. Existing flip users continue to retain `flip.js`.

Two costs are accepted and should be re-examined if they bite:

1. **The raw-block signal is intentionally broader than the shim's actual
   need.** A raw block with no literal `@` attribute still retains the shim.
   This is the safe direction: over-inclusion costs bytes, while under-inclusion
   can throw at runtime.
2. **The compiler now encodes runtime module boundaries.** Refactors of flip,
   Portal, or the raw-attribute shim must keep `ScanUsage` and every import-holding
   probe in sync or a feature silently vanishes. Mitigations: every probe
   defaults to feature-ON when its define is absent, and coverage exists at both
   scan and production-bundle levels.

**Bundle assertions must use string literals, never identifiers.** Minification
mangles function names, so asserting identifier absence passes vacuously.
Coverage uses `cubic-bezier(0.2, 0, 0, 1)`, `data-puzzle-portal`, and `@@` —
distinctive literals that survive minification.

The framework now carries three exclusion mechanisms (subpath export, define+DCE, virtual manifest). That is a conceptual ceiling worth respecting — a fourth should be resisted; new features should reach for the define+DCE gate established here.
