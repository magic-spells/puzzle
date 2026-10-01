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
---

# D170 — Persistent list blocks and an incremental virtual DOM

The todos fixtures (`tests/fixtures/todos/*.compiled.js`) are the byte contract
for what the compiler emits; the expects in `benchmarks/scenarios.mjs` are the
work gates. [[DECISION-D17-RENDER-FUNCTIONS-VDOM]] carries the rendering
decision this qualifies ("compiler-informed"); [[DECISION-D62-HANDLER-CACHING]]
the handler half.

## Context

Every view update rebuilt and diffed the whole `ViewNode` tree: a `{#for}` paid
N × (row allocation + diff) per parent update, and static-heavy templates
rebuilt thousands of vnodes for zero DOM writes. The goal: rows that update
independently and fewer wasted diffs, with the complexity in the compiler, no
`.pzl` syntax change, and no break to hybrid/static output.

## Decision

Keep the virtual DOM and make it incremental.

1. **An item-form `{#for}` is a persistent list block.** Each site compiles to
   `__l(this, owner, id, coll, (s) => …, __L<id>)` instead of `.map`, backed by
   `client-runtime/views/listBlock.js` via the `listRows` export. `listRows as
   __l` is imported **only by a file that lowers a site** (like
   `displayValue as __s`), so loop-free apps don't bundle it; nothing in
   `PuzzleView` imports it. The block keeps per-key row state (item, index,
   stored record revision, live scope object `s`, last vnode subtree, static
   caches, nested blocks) and returns the **cached subtree** for an unchanged
   row; the returned array is spliced where `.map()`'s was, so keyed patching,
   mixed keyed/unkeyed pairing, leaving rows and FLIP are untouched.
   **A row is dirty when**: its item is a plain object/array/function (always);
   a record's reference or revision changed; a primitive is `!==`; the body
   reads the counter and the index moved; a parent root the body reads is set
   in the per-render `__dirty` mask over `Class.__roots`; or the site is
   `volatile` — it calls a clock function (codegen's `clockFunctions`:
   `timeago`) or reads a loop local of an ENCLOSING site. Sites reading a
   relation, computed getter or deep path are **conservative** (checked once
   per model class against the schema) and never cache record rows. A null or
   duplicate key builds uncached (duplicate warns once in dev). A nested
   block's owner is the enclosing row, so inner blocks die with it.
2. **`patch()` short-circuits when old and new are the same object**, except:
   a live component's `el` is refreshed from the instance, and a component
   vnode with no live instance falls through to recovery. Cached subtrees
   re-assert controlled form values from a `controls` list collected at build
   (D147), including a vnode that is itself a controlled element.
   `collectControls` stops at an `island`'s children and walks through
   `<Portal>` children.
3. **Static subtrees are built once** per instance (`this.__c[n]`) or per row
   (`s.c[n]`): a maximal fully-static subtree of ≥3 vnodes, or a fully static
   `island` element's children at any size. A **dynamic** island seed is never
   cached — [[DECISION-D44-DOM-ISLANDS]] re-seeds on key-reset and hide/show
   remount, and a per-instance cache would replay the first render's values.
   Never cached: inside a snippet body, inside a non-lowered loop body, a
   subtree holding controlled `value`/`checked`, or the render root.
4. **Records carry a render revision** — the store notification sequence of
   the last mutation, under a Symbol from `client-runtime/renderRev.js` (its
   own import-free module shared by `store.js` and `views/`), defined
   non-enumerable at `_instantiate` and written in `Store._notify`. A child
   with a record prop compares against a **snapshot** (`__propRevs`, written at
   mount and each props-carrying `applyParentUpdate`), never the old prop
   object, which after an in-place mutation is the same advanced record.
5. **Loop handlers are identity-stable**: a handler whose arguments read only
   loop locals (and `event`) is cached on the row (`(s.h<n> ??= …)`) and reads
   the current item at fire time (`remove(todo.id)` →
   `this.events.remove(s.item?.id)`). A handler reading a data root (`__d`) or
   calling a library function (`__f`) gets a fresh closure per render, and its
   roots join the mask. Handler arguments add no other row facts (no fields,
   deep, counter or volatility): `listRows` reassigns `s.item`/`s.i` every pass.
6. **One flush, one `data()` run** for a child that both receives a record
   prop and queries it: `Store` publishes `_flushSeq` during delivery and a
   refresh inside it stamps `_settleMark`, reusing
   [[DECISION-D161-AUTO-FETCHING-FINDS]]'s early return.

**Non-lowered bodies** — a `<Snippet>` body, a range `{#for}` body, and an
item body that fell back to `.map` — lower and cache nothing inside them
(`mapDepth` in the emitter): such a body is emitted once and run per
iteration, so a block or cache slot there would be shared across iterations.
An explicit `key=` is hoisted into module-scope site meta only if it reads
nothing from `render()`; a key reading `__d` or `__f` keeps `.map` for the
site. The synthetic `ViewNode.keyOf(item)` key is always hoisted.

**Row facts come from the expression tree** (`codegen/lower.go`): a record
local is on identity only as a direct member (`todo.text`, joining `fields`)
or the whole value (`{ todo }`). A deeper path, computed member, method call,
or any opaque use (function argument such as `{ byline(post) }`, operand,
template-literal part, array element, object value) marks the site `deep`.

**Row scope names are reserved by mangling**: rows use `s`, `s1`, …; an
authored binding with that spelling that stays bare in a lowered body (range
counter, fallback loop local, snippet parameter, arrow parameter) becomes
`__pzl<name>`. `s` itself never moves — it is the fixture byte contract.

**Patcher invariants the caches require** (`viewManager.js`):

- A vnode present in both old and new unkeyed lists pairs with itself (a
  cached vnode can shift index behind a variable-length unkeyed run).
  `patchIndexedChildren` pre-scans for a reused vnode (`el != null`) not at its
  positional partner and hands the list to `patchKeyedChildren`, which
  re-pairs with an identity Set.
- A cached vnode inside a fresh, shifted parent is reached by the incoming
  tree first; `keepOutgoing`/`outgoingOf` snapshot its links (el, component,
  instance, html nodes, portal range) so the old position releases or patches
  the copy it describes. The map lives for one outermost render. Such a
  nested subtree is remounted, not moved.
- `patch()`'s replace arm unmounts before it mounts (a cached subtree is the
  same object in both trees).
- A block that missed a render rebuilds every row: it records the view's
  `__rgen` counter, since the root mask is a per-render delta. An errorView
  retry bumps `__rgen` so a failed child under a cached row is revisited.
- `mountComponent` ignores a destroyed pinned instance and `unmount` nulls
  `component`/`instance`, so a cached vnode can unmount and remount.

## Work gates (`npm run bench`, asserted exactly)

- `keyed-list/update-one/1000`: klRowsTouched 1, childDataRuns 1.
- `keyed-list/update-all/1000`: 1000 / 1000. `keyed-list/reorder/1000`: 0 / 0
  (moves only).
- `route-churn`: navigate-burst rcAncestorRenders 1,200; params-burst 600 —
  the reused-ancestor cascade is O(depth).
- `listener-churn/count-listeners/10000/churn`: 0 add/removeEventListener.
- `islands/shell-renders/20000`: islandViolations 0,
  islandChildVnodesPerRender 20,000 (dynamic seed, uncached).
- `deep-nest`: nodeDataRuns 1 of 1,536 for a single-node write.

Bundle size is reported by `npm run measure:size` (hello-world, todos); no byte
gate is enforced. A loop-free app pays for `__c`, `__dirty`/`__roots`,
`__propRevs`/`propsEqual`, `RENDER_REV`, the identity short-circuit and
`syncControl`, not `listBlock.js`.

## Alternatives

- **Compiled direct-DOM output (Svelte 5 / Solid)** — measured 25–27% larger
  gzipped on five real templates even with every emitter lever (static HTML
  strings compress worse than vnode literals; break-even ~13 templates), and
  it meant rewriting router composition, takeover, prerender and DevTools.
- **A runtime dependency layer** (per-row subscriptions, leases, a second
  scheduler) — the parent's `data()` re-runs anyway; a pull-based revision
  compare gives the same isolation.
- **Signals / proxies on records** — against the plain-class model.
- **Observing direct field assignment** (schema accessors) — changes record
  shape (`toJSON`, `Object.keys`, hydration); the path to exact revisions later.
- **Per-site memoization outside loops** — deferred pending measurement.
- **Full-depth pre-scan or pass-stamp release for shifted nested vnodes** —
  O(tree) per level / cannot tell a vnode's own old element from an adopted one.
- **Not built: dynamic island seed as a per-render thunk** evaluated at mount
  only (one closure instead of N vnodes, correct on remount); needs ViewNode,
  mount and the SSG serializer to accept thunk children.

## Consequences


- Contracts ([[DOC-SPEC-TEMPLATE]] §28/§31, [[DOC-SPEC-ANATOMY]] §4): a record
  prop invalidates its child on the record's own mutations (related records
  must be queried); row caching does not see direct field assignment — mutate
  through `update()` or a store path; plain objects never cache. Nothing else
  observable changes (keys, branches, slots, portals, SSG, takeover, router,
  DevTools, HMR).
- **Library functions must be pure.** A cached row does not re-run calls;
  clock-dependent values are either `timeago` (volatile) or computed in
  `data()`.
- The root mask is 32-bit; `__roots` caps at 31 entries and a site reading a
  root past the cap is `volatile`. No parent-root reads → no `__roots`.
- Reserved names: `__lists`, `__c`, `__dirty`, `__propRevs` on instances and
  `__roots` on the class are unenforced property reservations (SPEC §4;
  `__rgen` is internal too but not listed there). The module-scope `__L<n>`
  metas and the `__l` import are enforced by `scriptcollide.go`, only in files
  that emit them. `__pzl<name>` is the mangling space.
- Tests: `component-prop-bailout`, `static-cache-shift`,
  `patch-replace-ordering`, `list-cache-invalidation`, `list-control-replay`
  (vitest); `listblock_test.go`, `static_cache_test.go` (Go).
- Dev counters in [[FILE-DEVPERF]] report rows cached / rebuilt / conservative
  sites and static sites allocated.
