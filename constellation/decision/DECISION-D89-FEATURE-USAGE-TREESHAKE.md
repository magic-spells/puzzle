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
  - FILE-BUILD-OPTIONS
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-07-24T06:55:07.397Z'
verified_sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
notes:
  - kind: verified
    text: >-
      Verified at 1400ec6 (post-merge, PR #21): ScanUsage/hasFlipAttr(node.Props) in
      compiler/internal/plugin/scan.go, syncTitle/syncTags split across head.js/headTags.js, 2
      inlined __PUZZLE_HAS_FLIP__ probes in viewManager.js (post probe-reduction commit) all
      confirmed present. 1016 vitest + full Go suite green; todos/music drop both modules, blog
      retains flip.js, static-docs retains head tags across 5 prerendered pages.
    sha: 1400ec61c149495743ed81d9bc0aebf0ce920bd5
---

# D89 — pay-for-what-you-use runtime: feature-usage scan drives DCE defines

Two runtime modules shipped to every app regardless of use: `views/flip.js` (~1,360 min bytes) and the managed head-tag half of `head.js` (~1 KB, plus ~10 dead `querySelector` probes **per navigation** in a title-only app). A build-time usage scan now emits two literal esbuild defines — `__PUZZLE_HAS_FLIP__`, `__PUZZLE_HAS_HEAD_TAGS__` — that fold the runtime's guard probes so unused modules tree-shake out. This generalizes [[DECISION-D31-FORMATTER-TREESHAKE]]'s per-app inclusion discipline from formatters to whole feature modules, using [[DECISION-D57-HMR-STATE-RELOAD]]'s define+DCE mechanism.

## Context

The todos bundle roughly doubled (11.3 → 20.9 KB gzip) over two weeks of feature work. A sourcemap teardown attributed ~97% of the growth to the framework runtime, not app code — and several modules were unconditional imports that most apps never exercise. The framework already had three exclusion mechanisms (D31's virtual formatter manifest; the `./morph` subpath export nobody imports unless opting in; D57's `__PUZZLE_DEV__` define + DCE for devstate). This adds no fourth concept — it extends D57's define mechanism, fed by D31's scan infrastructure.

## Decision

**Runtime — `head.js` splits on a real seam.** `head.js` keeps the always-present core (`resolveHead`, `resolveField`, `HEAD_FIELDS`, and a new one-line `syncTitle`); the tag machinery (`MANAGED_TAGS`, `syncTags`, `setTagValue`) moves to `headTags.js`. The router calls `syncTitle` unconditionally and `syncTags` behind the gate. This split is justified independently of bundle size: it separates a pure resolver from a DOM mutator, and stops title-only apps running ~10 no-op `querySelector` probes on every navigation.

**Runtime — guard probes are inlined, never abstracted.** Every site that REFERENCES a gated import writes the full `typeof __PUZZLE_HAS_X__ === 'undefined' || __PUZZLE_HAS_X__` expression. A named module const or arrow helper is **NOT** constant-propagated by esbuild — verified empirically: with a named const, `var t=!1` survived and the guarded calls kept `flip.js` alive. Only the inlined form folds. Undefined ⇒ probe is true, so vitest, unbundled consumers, and foreign bundlers keep full behavior with no compiler.

Probe only what holds an import alive. In `patchKeyedChildren` that is exactly two sites — the `beginFlip` and `playFlip` calls. The `'flip' in newChild.attrs` detection is deliberately left bare: it references no import, so gating it buys no tree-shaking, only skipping one `in` check per child — the same check that already ran before this decision. Probes are verbose and sit in hot loops, so each one must earn its place by dropping bytes.

**Compiler — one scan, two signal qualities.** `ScanFormatters` generalizes to `ScanUsage`, keeping D31's fail-soft, over-inclusive policy (unreadable/unparseable files skipped; `node_modules`/`dist`/`build`/`vendor`/dot-dirs pruned):

- **flip — exact.** AST match on a `flip` attribute across element attrs, component props, and slot children. Component props are load-bearing: a component vnode's props *are* its attrs (`ViewNode` `get props()`), so the keyed patcher's `'flip' in newChild.attrs` fires for `<PostCard … flip>`. The first implementation checked elements only, which emitted `HAS_FLIP=false` for `examples/blog` and silently killed its animation — the false negative this scan must never produce. Guarded by `TestScanUsageFlipOnComponent`.
- **head tags — deliberately coarse.** Route `meta` lives in `app/routes.js`, user JavaScript the compiler never parses (`.pzl` `<script>` bodies are likewise opaque). So this is a raw substring scan of `.js`/`.ts`/`.pzl` for `description`/`canonical`/`socialImage`. See the honest limitation under Consequences.

Defines are recomputed for one-shot, watch/dev, prerender, and per-page static bundles. esbuild **freezes `Define` when a context is created**, so `WatchBuilder` tracks the baked-in bits and replaces the context only when one flips — otherwise a mid-session edit adding `flip` would build against stale defines while the incremental graph stayed warm.

## Alternatives rejected

- **A virtual "features manifest" module** (D31's exact shape) — defines are simpler here: each feature is one boolean, not a name subset, so there is nothing to enumerate into a module.
- **`puzzle.config.js` feature flags** — explicit and precise, but users must know the flags exist; forgetting one means silent bloat (default-on) or silent breakage (default-off). The scan needs no user action.
- **Gating `animate.js` / `visibility.js`** — declined. Animation specs are an `animations` class field in the opaque `<script>` body, so detection would need the same weak token scan, and the call sites sit on the per-mount hot path. Not worth the churn for ~1 KB; both stay unconditional.
- **Gating the `@event:outside` modifier (D86)** — deferred. Template-detectable and cheap to scan, but it is inline branches in `viewManager`, not a droppable module; a few hundred bytes against edits to delicate listener teardown.
- **A named const / helper for the probe** — does not tree-shake (see Decision).
- **Bundle-size regression budgets in CI** — considered and declined for now; the team preferred no added gate.

## Consequences

Apps pay only for features they use: `examples/todos` and `examples/music` drop both modules; `examples/blog` correctly **retains** `flip.js` (component flip); `examples/static-docs` retains head tags. Controlled A/B on the real runtime graph: **3,148 raw / 990 gzip bytes** dropped with both features off. todos measured 20,869 → 19,766 gzip.

Two costs are accepted and should be re-examined if they bite:

1. **The head-tag signal is a heuristic, not a fact.** `description` is a common English word; any app with a `description` model field, form label, or comment resolves `HAS_HEAD_TAGS=true` and pays the ~1 KB anyway. It is fail-safe (over-inclusion never breaks), but it will quietly stop paying off for many real apps. The `head.js`/`headTags.js` split is worth keeping regardless; the *gate* is the marginal part.
2. **The compiler now encodes runtime module boundaries.** Any refactor of flip or head must keep `ScanUsage` in sync or a feature silently vanishes. The component-flip miss proves this is easy to get wrong. Mitigations: the probe defaults to feature-ON when the define is absent, and coverage exists at both scan level (`TestScanUsageFlip*`) and bundle level (`TestBuildUsageDefinesDCE`).

**Bundle assertions must use string literals, never identifiers.** Minification mangles `beginFlip`/`MANAGED_TAGS`, so asserting their *absence* passes vacuously in a production bundle. Tests assert on `cubic-bezier(0.2, 0, 0, 1)` (flip.js's `DEFAULT_EASING`, unique to that module) and `data-puzzle-head` (headTags.js's marker), both of which survive minification.

The framework now carries three exclusion mechanisms (subpath export, define+DCE, virtual manifest). That is a conceptual ceiling worth respecting — a fourth should be resisted; new features should reach for the define+DCE gate established here.
