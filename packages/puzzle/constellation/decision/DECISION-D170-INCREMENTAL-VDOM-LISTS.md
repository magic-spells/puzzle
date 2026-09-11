---
name: >-
  D170 — Persistent list blocks and an incremental virtual DOM (keep the VDOM; cache what did not
  change)
status: built
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
  - kind: state
    text: >-
      2026-09-10 — BUILT on `feat/render-lists`, NOT yet verified. Runtime (bdf7e9d) and compiler
      (ff9454a) are in; both suites green at those shas (vitest 125 files / 2088 tests, `go test
      ./...` ok, test:types clean). Status stays `built` until the plan §11 gates are measured: byte
      gates (hello-world ≤ +0.5 KB, todos ≤ +1.5 KB, `examples/stays` ≤ +2.0 KB, five-template
      corpus ≤ +8%) and work gates (`list-update-1` builds ≤ one row's vnodes with 999 identity
      short-circuits; `list-reorder` builds 0 rows; island vnodes per render → 0; `deep-nest`
      unchanged at 1 of 1,536). A verification agent is running those now; when the numbers land
      they go on this card and on [[DOC-STRESS-EXAMPLE]], and the status moves to `verified`. Two
      measurement paragraphs elsewhere are deliberately left saying "being re-measured" until then:
      [[COMPONENT-VIEW-MANAGER]]'s island section and the `islands` row of DOC-STRESS-EXAMPLE.
    sha: ff9454a1857e785d8c8590e5d47f2a6030f107e8
  - kind: verified
    text: >-
      2026-09-10 — plan §11 gates MEASURED on `feat/render-lists`. WORK GATES all met, from the
      production `examples/stress` bundle: `keyed-list/update-one/1000` (one `record.update()` in
      1,000 rows) → childDataRuns 1, klRowsTouched 1, klDomMutations 2; `update-all` → 1000 / 1000 /
      2000 (no row counted twice); `reorder` (a display-order flip that writes no record) →
      childDataRuns 0, klRowsTouched 0, klDomMutations 1998 (moves only, nothing rebuilt);
      `islands/shell-renders/20000` → islandChildVnodesPerRender 0 (was 20,000) with
      islandViolations 0 and shellDidMutate 1; `deep-nest` unchanged at 1 of 1,536. Two further
      improvements the gates did not predict: the reused-ancestor cascade is O(depth) again
      (route-churn rcAncestorRenders 2,700 → 1,200, params-only control 2,100 → 600), and
      `listener-churn/count-listeners/10000/churn` reports 0 add/removeEventListener calls where it
      reported 400,000 — the churn arm now compiles to a row-cached handler.
      `benchmarks/baseline.json` was rewritten (83 ops); every counter moved in the improving
      direction. Two apparent regressions in that diff are NOT D170: route-churn rcAncestorMutations
      500 → 700 and rcChromeMutations 100 → 300 are the router's own focus bookkeeping per leaf
      swap, and a build of the branch point `release/0.8.0` measures the identical 700/300 — the
      baseline figures predate a 0.7.x-era change and were masked because the runner reports only
      the first mismatching declared counter per op.


      BYTE GATES: hello-world 21,304 → 21,834 B gzip (+530 B, +0.52 KiB) against a ≤ +0.5 KB gate —
      18 bytes over 512, which is Cory's call; todos 24,365 → 25,732 B (+1,367 B, +1.34 KiB) against
      ≤ +1.5 KB, PASS; `examples/stays` 40,007 B (+1.37 KiB on 37.7 KB) against ≤ +2.0 KB, PASS. The
      hello-world figure is what it is only because the list runtime is now an import:
      `views/listBlock.js` is 975 B gzip on its own and used to ride into every app through
      `PuzzleView.__list`. What remains in a loop-free app is the rest of the mechanism — `__c`,
      `__dirty`/`__roots`, `__propRevs`/`propsEqual`, `RENDER_REV`, the patch() identity
      short-circuit and `syncControl`.
  - kind: verified
    text: >-
      2026-09-11 — the gates the two notes above call "plan §11" are recorded here, now that the
      planning documents are gone. They are the D170 gates: the expects in
      `benchmarks/scenarios.mjs` plus these numbers.


      BUNDLE GZIP (Node zlib level 9, `npm run measure:size`, re-run on `feat/render-lists`
      2026-09-11): hello-world 21,834 B (+530 B on the 0.7.1 21,304 B) against a ≤ +0.5 KB gate — 18
      bytes over 512, MARGINAL, and Cory's call; todos 25,732 B (+1,367 B on 24,365 B) against ≤
      +1.5 KB, PASS; `examples/stays` 40,007 B (+1,402 B) against ≤ +2.0 KB, PASS.
      `measure-size.mjs` builds and prints hello-world and todos only — it emits no
      `examples/stays`, corpus or total line, so the stays figure is the one measured in the
      2026-09-10 gate run and the ≤ +8% five-template corpus gate has no script behind it. The
      hello-world overage is structural, not incidental: `views/listBlock.js` is 975 B gzip and is
      now an import rather than riding in through `PuzzleView.__list`, so a loop-free app pays only
      for `__c`, `__dirty`/`__roots`, `__propRevs`/`propsEqual`, `RENDER_REV`, the patch() identity
      short-circuit and `syncControl`.


      BENCH (`benchmarks/baseline.json`, regenerated on this branch): keyed-list/update-one/1000 →
      childDataRuns 1, klRowsTouched 1, klDomMutations 2; keyed-list/update-all/1000 → 1000 / 1000 /
      2000; keyed-list/reorder/1000 → 0 / 0 / 1998; keyed-list/swap-rows/1000 → 0 / 0 / 1994;
      islands/shell-renders/20000 → islandChildVnodesPerRender 0; route-churn navigate-burst
      rcAncestorRenders 1,200 (was 2,700) and params-burst 600 (was 2,100); listener-churn
      count-listeners lcAddListener/lcRemoveListener 0 (was 400,000).


      Prerendered HTML is byte-identical across the 78 example output files. Suites green on this
      branch: `go vet ./...` + `go test ./...` (all packages ok) and `npx vitest run` (127 files /
      2094 tests passed).
---

# D170 — Persistent list blocks and an incremental virtual DOM

**Built for 0.8.0.** This card is the record: it holds the decision, its
reasoning, and what the built mechanism actually is. The hand-written todos
fixtures (`tests/fixtures/todos/*.compiled.js`) are the byte contract for what
the compiler emits, and the expects in `benchmarks/scenarios.mjs` are the work
gates. The 0.8.0 planning documents were removed at Cory's request on
2026-09-11. [[DECISION-D17-RENDER-FUNCTIONS-VDOM]] carries the
rendering decision this qualifies ("compiler-informed"), and
[[DECISION-D62-HANDLER-CACHING]] carries the handler half.

## Context

Every view update rebuilt the whole `ViewNode` tree and diffed it, whether or
not anything changed: a `{#for}` paid N×(row vnode allocation + diff) per
parent update, and static-heavy templates rebuilt thousands of vnodes that
produced zero DOM writes ([[COMPONENT-VIEW-MANAGER]]'s island measurement:
20,000 of 20,000 child vnodes rebuilt per render). Cory asked for lists whose
rows update independently and for fewer wasted diffs, with the complexity in
the compiler, no `.pzl` syntax change, and no break to hybrid/static output.

A compiled direct-DOM rewrite (Svelte/Solid style) was planned first and
measured on five real templates: the emitted output was 25–27% larger gzipped
in a bundle even with every emitter lever (table-driven bindings, walk
descriptor, constant folding, Solid-style tag tightening), because the static
HTML string itself compresses worse than the vnode literals and one vnode
encoding serves both creation and update. Break-even was ~13 templates. The
direct-DOM plan was removed with the planning documents; the measurements in
this paragraph and on [[DECISION-D17-RENDER-FUNCTIONS-VDOM]] are its record.

## Decision

Keep the virtual DOM and make it incremental. Six additive pieces; `.pzl`
syntax is unchanged.

1. **An item-form `{#for}` is a persistent list block.** Each loop site
   compiles to `__l(this, owner, id, coll, (s) => …, __L<id>)` in place of
   `.map`, backed by `client-runtime/views/listBlock.js` and reached through the
   package root's `listRows` compiler-support export. `listRows as __l` joins
   the injected import line **only for a file that lowers at least one site** —
   exactly as `displayValue as __s` does, and for the same reason: a loop-free
   app must not pull the list runtime into its bundle, and nothing in
   `PuzzleView` may import it. The first argument is always the view (it owns
   the `__dirty` root mask and the dev counters); the second is the owner the
   rows hang off. The block keeps one row state per key — item, index, stored
   record revision, the live scope object `s` handlers close over, the row's
   last rendered vnode subtree, its static caches and its nested blocks — and
   returns the **cached vnode subtree** for a row whose inputs did not change.
   The returned array is spliced where `.map()`'s was, so the keyed patcher,
   mixed keyed/unkeyed pairing, the shared sibling key namespace, leaving rows
   and FLIP are untouched. Dirtiness: plain objects, arrays and functions always
   (no revision exists to observe); records on reference or revision change;
   primitives on `!==` alone; the index when the body reads the counter; a
   parent root the body reads, via a per-render `__dirty` mask over the
   compiler-emitted `Class.__roots`; and a `volatile` body — one whose
   expressions reach through `this`. Sites reading a relation, a computed
   getter or a deep path are **conservative** (checked once per model class
   against the schema, cached on the block) and never cache their record rows.
   A null key builds uncached (today's positional path, already warned by
   `ViewNode.keyOf`); a duplicate key within one render builds uncached and
   warns once in dev. Site ids are per file and share the `__h`/`__c`
   counters; a nested block's owner is the enclosing row state, so inner
   blocks are keyed per outer row and die with it.
2. **`patch()` short-circuits when old and new are the same object.** Two
   carve-outs ride with it: a live component's `el` is refreshed from the
   instance (a child can replace its root between renders, and
   `patchKeyedChildren` uses `newChild.el` as its move guard and insertion
   ref), and a **component vnode with no live instance falls through** to the
   ordinary path — a destroyed instance or the takeover-failed `null` arm must
   still reach `patch()`'s recovery, or a cached row would strand a failed
   position forever. Cached subtrees carrying controlled form values re-assert
   them from a `controls` list collected when the row was built, so D147's
   live-DOM drift correction survives. `mountComponent` ignores a pinned
   instance that is already destroyed and `unmount` nulls `component`/
   `instance`, so a cached vnode can be unmounted by a branch toggle and
   mounted again.
3. **Static subtrees are built once** per instance (`this.__c[n]`) or per row
   (`s.c[n]`): a maximal fully-static subtree of three or more vnodes, or an
   **`island` element's children array at any size, whatever it contains**.
   The island case is the one cache site with no static requirement, and the
   D44 contract is what licenses it: the seed is built once at mount and the
   patcher may never reconcile it again, so a `{#for}` inside an island
   evaluates once, an interpolation inside one is its mount-time value, a
   handler on a seeded child is wired once, and a component or composition
   marker inside an island is already a compile error. (When the island's sole
   child is a `{#for}`, the wrapper goes round the lowered list call itself.)
   The island ELEMENT is still wrapped only when it is fully static. Never
   inside a snippet body (stamped per expansion, no owner), never anywhere
   inside a **range** `{#for}` body — a range keeps `.map` and owns no row
   scope, so its one slot would be shared by every iteration and the same vnode
   mounted at N DOM positions (the exclusion holds at any nesting depth,
   including a range nested in a lowered row, where an `s.c[n]` slot is per-row
   but still shared across the range) — never a subtree holding a controlled
   `value`/`checked`, and never the render root: roots are emitted by
   `emitComponentRoot`/`emitSkeletonRoot`, which do not go through the cache
   wrapper at all.
4. **Records carry a render revision** — the store notification sequence of
   the last observable mutation, under a Symbol exported by
   `client-runtime/renderRev.js` (its own import-free module: `store.js` writes
   it and `views/` reads it, and neither side may import the other). It is
   defined non-enumerable at `_instantiate` beside `_type` so every record
   keeps one hidden class, and written in `Store._notify`; every mutation path
   reaches `_notify`. A component receiving a record prop compares against a
   **snapshot** of that revision stored on the child when props were applied
   (`__propRevs`, written at mount and at every `applyParentUpdate` carrying
   props), never against the old prop object — after an in-place mutation both
   sides hold the same already-advanced record. Relation and computed-getter
   changes still require the child to query in its own `data()`.
5. **Loop handlers are identity-stable**: a handler whose arguments capture
   only lowered-loop locals rewrites those locals to the row scope and caches
   the closure on the row (`(s.h<n> ??= …)`), reading the current item at fire
   time. A handler reading `__d.` keeps its fresh closure and its roots join
   the site's mask. A `this.…` argument is evaluated at fire time against an
   instance that outlives every render, so `this` inside a handler **argument**
   does not make a site volatile — only `this` in the body's own expressions
   does.
6. **One flush, one `data()` run** for a child that both receives a record
   prop and queries that record: `Store` publishes `_flushSeq` for the
   duration of delivery, and a refresh started inside it stamps `_settleMark`
   on commit, so the child's own `onStoreChange(seq)` takes the existing
   `seq <= _settleMark` early return ([[DECISION-D161-AUTO-FETCHING-FINDS]]'s
   mechanism, one more case).

Two loop shapes are deliberately not lowered and keep today's emission: **range
loops** (`{#for 1...5}`, rows cheap and keyed by value) and **loops inside a
`<Snippet>` body** (stamped fresh per expansion, so a block keyed by site id
would be shared between stamps). An **explicit `key=` moves into the site
meta** as `(item) => <expr>` only when it reads nothing that lives inside
`render()`; a key reading `__d`, `__f` or `this` keeps `.map` for the whole
site rather than emitting a module-scope arrow that would throw.

## Alternatives rejected

- **Compiled direct-DOM output (Svelte 5 / Solid shape).** Measured larger on
  real Puzzle templates (see Context); its CPU win is mostly reachable with the
  pieces above; it required rewriting router composition, takeover, prerender,
  DevTools and ~60 test files and carried several behavior changes.
- **The original GPT handoff's runtime dependency layer** (per-row store
  subscriptions, leases, render receipts, a second scheduler, a shared
  `ChildDomain`, a VDOM-bridge stage, a legacy renderer subpath): the parent's
  `data()` must re-run anyway, so a pull-based revision compare during its pass
  gives the same isolation with no subscription lifecycle.
- **Signals / proxies on records:** against the plain-class model; the revision
  + snapshot rule gives record-level invalidation without them.
- **Per-site memoization of dynamic subtrees outside loops:** deferred to 0.8.x
  pending measurement; lists are where the N× cost is.
- **Observing direct field assignment** (accessors per schema field on the
  prototype): would change record shape (`toJSON`, `Object.keys`, hydration);
  out of scope, noted as the way to make revisions exact later.

## Consequences

- Contracts, spelled out in the SPEC ([[DOC-SPEC-TEMPLATE]] §28/§31,
  [[DOC-SPEC-ANATOMY]] §4): a record prop invalidates
  its child on the record's own mutations (a child that needs a *related*
  record's changes must query it — the documented idiom); row caching does not
  observe direct field assignment on a record, so mutate through `update()` or
  a store path; plain objects never cache; loop handlers are stable; controlled
  inputs in cached rows are re-asserted from the controls list. Nothing else
  observable changes: keys, sibling namespace, branches, skeletons, slots,
  portals, animations, SSG output, takeover, router, DevTools protocol, HMR.
- The root dirty mask is 32-bit and the compiler caps `__roots` at 31 entries;
  a site reading a root past the cap is marked `volatile` (always dirty) rather
  than silently landing in the wrong bit. A template whose loops read no parent
  root emits no `__roots` and skips the mask computation entirely.
- Reserved names: `__lists`, `__c`, `__dirty`, `__propRevs` on instances and
  `__roots` on the class are **property reservations** documented in SPEC §4 —
  nothing enforces them, exactly as `__h`/`__ref`/`__bind` are not enforced.
  The enforced names are module-scope: the `__L<n>` meta consts and the import
  local `__l`, both checked by `scriptcollide.go`'s reserved-binding check,
  because a `<script>` binding one would be a real duplicate declaration in the
  emitted module. Each is reserved only for a file that actually emits it, so a
  loop-free `.pzl` may still declare `__l` or `__L0`. There is no `__list`
  instance method: the block is reached through the import.
- `component-prop-bailout.test.js` pins the new measurement: one changed record
  wakes one child. The hand-written fresh-closure arm stays as characterization
  of a cost an authored view can still pay.
- Dev counters in [[FILE-DEVPERF]] report rows cached / rebuilt / conservative
  sites and static sites allocated, so an author can see why a list is still
  rebuilding every row.
