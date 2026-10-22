---
name: VIEW_LIFECYCLE.md — frontend runtime map
status: built
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - FLOW-REACTIVITY
  - DOC-SPEC
  - DOC-SPEC-VIEW
  - DOC-ROUTER
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
---

> The end-to-end map of the frontend runtime: the vdom rendering model, per-node listeners, component states, the navigation state machine, and the complete re-render trigger table. Acceptance spec for [[COMPONENT-PUZZLE-VIEW]] and the router's navigation pipeline; the product contract is [[DOC-SPEC]].

# View Lifecycle & Frontend Runtime Map

## 1. Rendering model

**A virtual DOM, Vue-style (D17).** Templates compile to a `render()` returning a `ViewNode` tree; the runtime diffs it against the previous tree and patches the DOM. The Go compiler only emits render functions — **all reactivity lives in the runtime** (`data()` re-runs → new tree → diff), so the runtime is testable with no compiler. Rejected: Svelte-style compiled updates (per-binding dependency tracking in the compiler) and shadow DOM (`PuzzleView` is a plain class, D15; shadow roots would block global Tailwind CSS and complicate event bubbling).

**The tree is not rebuilt whole (D170).** A maximal static subtree is cached per owner (`this.__c[n]` at view level, `s.c[n]` in a loop row) and returned by reference; an item-form `{#for}` compiles to a persistent list block (`listRows`, `views/listBlock.js`) that returns a row's previous subtree unless its inputs changed (§5). `patch()` short-circuits when both sides are the same object, which makes both free.

**`<puzzle-view>` (D20).** Views and layouts get a real `<puzzle-view>` root element — the boundary navigation swaps, `this.element` points at, and animations run on. Components render inline with a single root and no wrapper, so nesting never stacks wrappers or disturbs flex/grid; attributes on `<puzzle-view>` in a component are a compile error. State lives on the `PuzzleView` instance, never on the element.

## 2. Event listeners: per-node (D18)

`@click={ addTodo(event) }` compiles to a vnode attr; the ViewManager `addEventListener`s it on that element at mount and swaps/removes it on patch. Handlers are cached per site (`this.__h`, or `s.h0` on a loop row), so they stay identity-stable and listeners do not churn.

Rejected: document-level delegation — listener count is already bounded by visible DOM and the keyed patcher moves nodes with their listeners, while delegation adds target routing, non-bubbling special cases and murky `stopPropagation`. The template syntax would not change if it were ever revisited. There is no global event bus: component → store → subscribed components is the path.

## 3. Component states

```
created ──▶ loading ──▶ rendered ──▶ mounted ⇄ updating ──▶ destroyed
```

- **created** — `created()` fires at the start of `mount()` (or `preload()` for a router-preloaded view), after class fields such as `events` are initialized. The base class never reads `this.events` in its constructor.
- **loading** — `data(params, props)` runs inside `store.withTracking(component, …)`; an async `data()` holds here. On first load a declared `<puzzle-skeleton>` renders at once and is swapped for the real tree when data commits (D39); `mounted()` then fires against the skeleton DOM and the swap is bracketed by `beforeUpdate`/`afterUpdate`. Without a skeleton nothing shows until the first tree lands. On re-runs the previous render stays up; a skeleton never reappears (`loaded` latches on first commit).
- **rendered / mounted** — `mounted()` fires once, after the first real render is in the DOM, never on a view destroyed or leaving during its `data()` await. A `mounted()` throw destroys the instance, and what fills its position depends on the **owner** ([[DECISION-D143-MOUNT-THROW-OWNERSHIP]]): a component-owned view leaves a placeholder the next parent patch refills (D115); a router-owned view keeps its position — the committed URL/title/history are never rolled back — and the app `errorView` fills it, or an invisible placeholder when none is configured ([[DECISION-D145-ERROR-BOUNDARIES]]); a static-kernel root or a first-navigation prerender takeover with no error view restores the prerendered content (D140).
- **updating** — a trigger from §5 produces a new tree: `beforeUpdate()` → patch → `afterUpdate(prev)` ([[DECISION-D178-AFTERUPDATE-PREV]]). `prev` is a frozen, shallow snapshot of what the previous render drew — `{ props, params, route, data }` (`data` is the merged `getData()` result, shallow-copied; no `refs`, `element` or `ctx`). The snapshot is taken **as each render lands** (in `#renderNowInner`, mount render included), not when an update starts — `setData()` writes immediately and `refresh()` swaps props/params/route before `data()` runs. A record in `prev.data` is the **same live object** (`prev.data.post === this.data.post` after an edit to that post), so to detect an edit return the field from `data()` (`title: post.title`) and compare that. Only classes that override `afterUpdate` pay for the snapshot; prerender never calls the hook.
- **destroyed** — `store.unsubscribe(component)`, ViewManager clears the subtree, element refs are nulled, `destroyed()` fires (a throw is reported, never wedges teardown). Idempotent.

## 4. Navigation state machine (D19)

```
push / replace / link click          popstate
            │                           │
            ▼                           ▼
MATCH route ── no match → catch-all `*` route, else warn + stay (URL untouched, no token bump)
            │  token bumped only now
            ▼
GUARDS (D87) root → leaf, before any view exists:
       false/throw → stay put; string → redirect via replace()
            ▼
LOAD   keep = shared chain-prefix length; instantiate fresh views [keep..N]
       (+ layout if its class changed); await fresh data() and PREPARE
       reused ancestors' data() (D146). Skeleton views are not awaited.
            │  stale token → discard fresh views + prepared runs
            ├── keep === chain length (params/query only): no transition,
            │   straight to COMMIT ───────────────────────────────┐
            ▼                                                     │
TRANSITION out: viewWillHide → out animation → viewDidHide        │
       → destroyed  (sequential default, D28; overlap mode D56)   │
            ▼                                                     │
COMMIT (one synchronous block, D19/D61/D146): pushState → title ◀─┘
       → mount → router state → prepared ancestor commits
            ▼
mounted() → viewWillShow → in animation (not awaited) → viewDidShow → IDLE
```

Rules, each fixing a real ordering bug:

1. **The URL commits with the render, not before.** `pushState`, title/head and the incoming mount land in one synchronous block (after the out animation in sequential mode), so a failed, cancelled or superseded navigation leaves URL, title, history and view untouched (D61).
2. **Last navigation wins.** Each matched navigation takes a monotonic token; a `data()` resolving for a stale token is discarded. The bump happens **after** the match, because an unmatched push must not strand an in-flight transition mid-`out`.
3. **`data()` rejection = stay put.** The error goes through the D145 funnel (`onError`); fresh views are destroyed, prepared ancestors discarded, no history entry is created, and a transition stranded mid-`out` is restored. On popstate the router puts the committed URL back with `replaceState`. A skeleton view's own `data()` failure (it is already on screen) shows the `errorView` instead.
4. **404 via catch-all.** A top-level `path: '*'` is checked last regardless of definition order; without one the router warns and stays.
5. **Chain-prefix reuse (D30).** A route resolves to a chain of views (root → leaf) hosted through each level's `<Slot/>` under one top-level layout. The shared prefix is reused: reused ancestors re-run `data()` with the full merged params, awaited before the URL commits but **prepared, not committed** — their state lands only with the navigation, so a failure leaves them untouched ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). A layout swaps only when `keep === 0`; a reused layout (same class) is patched, not remounted, and its chrome `data()` re-runs **after** the state commit so it reads a fresh `router.current`. A params-only *replace* also skips the focus move and route announcement (D135).
6. **One animator per transition.** The animator is the topmost swapped instance — `views[keep]`, or the layout on a layout swap; fresh instances below it are `skipEnter()`'d. The four hooks (`viewWillHide`/`viewDidHide`/`viewWillShow`/`viewDidShow`) fire in order even with no `animations` declared. `transitionMode: 'overlap'` (per route, per child route, or app default) pins the leaver with inline `position: fixed` at its measured rect and runs out and in concurrently (D56). Contract: [[DOC-SPEC-ROUTER]].
7. **The route snapshot rides LOAD (D47).** Every gated `preload()`/`refresh()` carries the navigation's frozen snapshot, read as `this.route` in `data()` — the only route source describing the navigation being gated, since `location` and `router.current` still hold the old route during LOAD ([[DECISION-D47-ROUTE-SNAPSHOT]]).

## 5. What triggers a re-render

| Trigger | `data()` re-runs? | What happens |
|---|---|---|
| Store record created/updated/destroyed matching a query this view made in `data()` | yes | batched flush → tracked re-run → diff/patch |
| Navigation reusing the view (new params/query) | yes | per §4; also delivers the route snapshot (`this.route`) |
| Parent re-renders with changed props | yes | props compare shallowly by reference; a prop that is a store **record** also compares by render revision (`renderRev.js`, the store's notification sequence for that record) against the snapshot taken when props were last applied, so `<TodoItem todo={todo}/>` re-runs when that record changes. A related record, a computed getter's inputs, or a direct field assignment advance no revision. |
| Two-way bind write-back (D147) | yes | `setData` + refresh, or `record.update()` and the store flush behind it |
| Parent re-render with new slot content only | no | re-render with the existing model (only once mounted) |
| `this.setData(...)` | no | state merged, re-render scheduled (rAF-batched) |
| Anything else (locals, direct DOM pokes) | no | not reactive by design |

Both flushes batch: the store flush notifies each subscribed view once per batch, and the view scheduler folds many `setData` calls into one render. A child that both takes a record prop and queries that record is woken once: a refresh started during a store batch stamps that batch's sequence and the child's own notification for it is skipped (D170, on the D161 settle mark). Subscriptions reset on every `data()` run — a view is subscribed to exactly what its latest `data()` queried.

**What a `{#for}` costs a parent render (D170).** One key read per item plus a rebuild of each dirty row; clean rows return their previous subtree and `patch()` short-circuits. A row is dirty when: its item reference changed; a record item's render revision advanced; the index changed and the body reads the counter; a parent `data()` root the body reads changed this render; the site is volatile (a clock-reading function like `timeago`, a read of an enclosing loop's local, or a root past the 31-bit mask); the site is conservative (a relation, computed getter or deep path); the block missed a render (its `{#if}` was false or its enclosing row was cached); or its last build threw. Plain objects and arrays have no revision, so their rows rebuild every render but keep cached handlers and static subtrees; primitives cache on `!==`. A null or duplicate key drops that row to uncached positional building (with a dev warning). A template never reaches the view instance (`this` is a compile error, D176) or browser globals, so neither is a row input. Controlled form values in a cached row are re-asserted by the patcher. Rows not visited leave through the ordinary unmount path, leave animations and FLIP unchanged. **Not lowered:** range loops and loops inside a `<Snippet>` body keep a per-render `.map`.

## 6. Who owns what

| Concern | Owner |
|---|---|
| DOM creation, patching, listener attach/swap | ViewManager (the only code that touches the DOM) |
| Component state, lifecycle hooks, update scheduling | PuzzleView |
| Subscriptions, change batching, model instantiation | Store |
| Navigation, route matching, layout/`<Slot/>` composition, title/head | Router |
| `ctx` wiring (`store`, `router`, `formatters`, plus `i18n` when translations are configured) | PuzzleApp |
