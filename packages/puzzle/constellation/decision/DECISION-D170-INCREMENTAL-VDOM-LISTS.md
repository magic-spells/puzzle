---
name: >-
  D170 — Persistent list blocks and an incremental virtual DOM (keep the VDOM; cache what did not
  change)
status: planned
connections:
  - DECISION-D17-RENDER-FUNCTIONS-VDOM
  - DECISION-D58-LIST-KEYING
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - DECISION-D161-AUTO-FETCHING-FINDS
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - FLOW-REACTIVITY
  - DOC-VIEW-LIFECYCLE
notes:
  - kind: decision
    text: >-
      2026-09-10 revision 2 — after a GPT-6 Pro review of the plan, the decision text was tightened
      on correctness rather than direction: (1) revision comparisons always use a snapshot number
      stored at the last commit, never the old object's live value (same object); (2) model-valued
      roots are treated as always dirty in 0.8.0 because a revision cannot cover relation getters or
      computed getters — revision-narrowed roots and the whole-row skip move to 0.8.x; (3) volatile
      bindings guard on a reserved pass bit, since an all-ones root mask is zero on a pass with
      nothing dirty; (4) the takeover barrier stages portal ranges and document-level outside
      listeners, not only mounted() hooks; (5) template cloning is defended against HTML parser
      repair (compiler prediction, dev walk check, browser suite) with an imperative emitter mode;
      (6) blocks are created detached and initialized before insertion; (7) island seed bindings
      initialize once; (8) skeleton swaps preserve root identity when root tags match; (9) slot-only
      updates keep the child's beforeUpdate/afterUpdate timing. Plan file §17 has the full table.
  - kind: state
    text: >-
      2026-09-10, later — RECOMMENDATION REVERSED, pending Cory. Two byte measurements on five real
      templates (todos ×3, music QueueDialog + AppLayout), hand-written in the compiled shape and
      minified+gzipped against today's vnode output: naive guard-line shape +52% gzip across a
      five-template bundle; with table-driven bindings + walk descriptor + constant folding (and
      Solid-style tag tightening) still +25–27% gzip (+18–20% per tail), minified at parity. The
      floor is the static HTML itself: template strings gzip ~560–625 B worse than vnode literals
      over five templates, and a shared block()/walk() runtime adds ~506 B gzip per app. Break-even
      ~13 templates; todos −2 KB, stays +0.5 KB, music +1.4 KB. The +10% gate is missed by every
      variant. Fable's recommendation is to re-scope this decision to a compiler-informed VDOM —
      persistent keyed list blocks with cached row vnode subtrees, an identity short-circuit in
      patch(), static subtree caching per instance/row, the record render revision with snapshot
      prop compare, stable loop handlers via a live scope object, flush-seq dedupe — keeping the
      direct-DOM design on file as the measured alternative (plan file §11.1–§11.2). Card body still
      describes the direct-DOM decision until Cory confirms the re-scope.
---

# D170 — Persistent list blocks and an incremental virtual DOM

**Status: PLANNED for 0.8.0 — not built.** The plan of record is
`plan/Puzzle-Render-Upgrade.md` (package-relative; not shipped). This card
records the decision and its reasoning; the plan file holds the mechanics,
phases, tests and gates. When built, [[DECISION-D17-RENDER-FUNCTIONS-VDOM]]
is amended in place ("compiler-informed") and
[[DECISION-D62-HANDLER-CACHING]] is rewritten.

## Context

Every view update rebuilds the whole `ViewNode` tree and diffs it, whether
or not anything changed: a `{#for}` pays N×(row vnode allocation + diff) per
parent update, and static-heavy templates rebuild thousands of vnodes that
produce zero DOM writes ([[COMPONENT-VIEW-MANAGER]]'s island measurement:
20,000 of 20,000 child vnodes rebuilt per render). Cory asked for lists whose
rows update independently and for fewer wasted diffs, with the complexity in
the compiler, no `.pzl` syntax change, and no break to hybrid/static output.

A compiled direct-DOM rewrite (Svelte/Solid style) was planned first and
measured on five real templates: the emitted output was 25–27% larger
gzipped in a bundle even with every emitter lever (table-driven bindings,
walk descriptor, constant folding, Solid-style tag tightening), because the
static HTML string itself compresses worse than the vnode literals and one
vnode encoding serves both creation and update. Break-even was ~13 templates.
That plan is archived at `plan/rejected/Puzzle-Direct-DOM-Rendering.md`.

## Decision

Keep the virtual DOM and make it incremental. Six additive pieces:

1. **`{#for}` compiles to a persistent list block.** Each item-form loop site
   keeps one row state per key — item, index, stored record revision, a live
   scope object handlers close over, the row's last rendered vnode subtree,
   its static caches and nested blocks. On a parent render the block returns
   the **cached vnode subtree** for a row whose inputs did not change and
   rebuilds only dirty rows. The returned array is spliced where `.map()`'s
   was, so the keyed patcher, mixed keyed/unkeyed pairing, the shared sibling
   key namespace, leaving rows and FLIP are untouched. Dirtiness: plain
   objects and arrays always; records on reference or revision change; index
   when the body reads it; parent roots the body reads (via a per-render
   `__dirty` mask over a compiler-emitted `__roots` stamp). Sites reading a
   relation, a computed getter or a deep path are **conservative** (checked
   once per model class against the schema) and never cache record rows.
   Null keys build uncached (today's positional path); a duplicate key within
   one render builds uncached and warns. Range loops and snippet bodies are
   unchanged.
2. **`patch()` short-circuits when old and new are the same object**, with a
   controls list so cached subtrees still re-assert controlled form values
   every pass (D147 drift correction preserved). `mountComponent` ignores a
   destroyed pinned instance and `unmount` nulls the links, so a cached
   vnode can be unmounted by a branch toggle and mounted again.
3. **Static subtrees are built once** per instance (`this.__c[n]`) or per
   row (`s.c[n]`): three or more vnodes, or an island's children; never
   inside snippet bodies; never a subtree holding a static controlled value.
4. **Records carry a render revision** — the store notification sequence of
   the last observable mutation, under a Symbol (`RENDER_REV`) defined at
   `_instantiate` and written in `Store._notify`; every mutation path reaches
   `_notify`. A component receiving a record prop is compared against a
   **snapshot** of that revision stored on the child when props were applied
   (`__propRevs`), never against the old prop object, which is the same live
   record. Relation changes still require the child to query, as documented.
5. **Loop handlers are identity-stable**: locals rewrite to the row scope
   and the closure is cached on the row (`s.hN ??= …`), reading the current
   item at fire time. Handlers reading `__d.` keep fresh closures.
6. **One flush, one `data()` run** for a child that both receives a record
   prop and queries the record: a refresh started during delivery stamps
   `_settleMark` with the delivering sequence ([[DECISION-D161-AUTO-FETCHING-FINDS]]
   mechanism, one more case).

## Alternatives rejected

- **Compiled direct-DOM output (Svelte 5 / Solid shape).** Measured larger
  on real Puzzle templates (see Context); its CPU win is mostly reachable
  with the pieces above; it required rewriting router composition, takeover,
  prerender, DevTools and ~60 test files and carried several behavior changes.
- **The original GPT handoff's runtime dependency layer** (per-row store
  subscriptions, leases, render receipts, a second scheduler, a shared
  `ChildDomain`, a VDOM-bridge stage, a legacy renderer subpath): the
  parent's `data()` must re-run anyway, so a pull-based revision compare
  during its pass gives the same isolation with no subscription lifecycle.
- **Signals / proxies on records:** against the plain-class model; the
  revision + snapshot rule gives record-level invalidation without them.
- **Per-site memoization of dynamic subtrees outside loops:** deferred to
  0.8.x pending measurement; lists are where the N× cost is.
- **Observing direct field assignment** (accessors per schema field on the
  prototype): would change record shape (`toJSON`, `Object.keys`, hydration);
  out of scope, noted as the way to make revisions exact later.

## Consequences

- Contracts, documented in the plan §7: a record prop invalidates its child
  on the record's own mutations (a child relying on callback churn to refresh
  on a *related* record's change must query it — the documented idiom); row
  caching does not observe direct field assignment on records (mutate through
  `update()` or a store path); plain objects never cache; loop handlers are
  stable; controlled inputs in cached rows are re-asserted from the controls
  list. Nothing else observable changes: keys, sibling namespace, branches,
  skeletons, slots, portals, animations, SSG output (byte-identical),
  takeover, router, DevTools protocol, HMR.
- Runtime grows ~1 KB gzip (measured in Phase 0); per-template output grows by
  the list call and cache wrappers. Gates: todos ≤ +1.5 KB, hello-world
  ≤ +0.5 KB, `stays` ≤ +2 KB, five-template corpus ≤ +8%; `list-update-1`
  builds ≤ one row's vnodes; island vnodes per render → 0.
- `component-prop-bailout.test.js` pins the D62 measurement that stable
  handlers supersede and is updated deliberately.
- Build order: Phase 0 fixtures + stress baseline, Phase 1 runtime (Opus),
  Phase 2 compiler (Codex), Phase 3 integration/docs. Reserved names added:
  `__list`, `__c`, `__roots`, `__lists`, `__dirty`, `__propRevs`.
