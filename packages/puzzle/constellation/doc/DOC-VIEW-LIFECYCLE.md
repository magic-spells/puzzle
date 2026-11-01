---
name: View lifecycle and runtime map
status: built
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - COMPONENT-STORE
  - FLOW-REACTIVITY
  - FLOW-NAVIGATION
  - STATE-VIEW-LIFECYCLE
  - DOC-SPEC
  - DOC-SPEC-VIEW
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DECISION-D17-RENDER-FUNCTIONS-VDOM
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D178-AFTERUPDATE-PREV
---

> The frontend runtime map: rendering model, listeners, view states, the
> navigation state machine, the re-render trigger table, and who owns what. The
> author contract is [[DOC-SPEC]]; implementation detail lives in the component
> cards. Code comments cite the §-numbers below.

# View lifecycle and runtime map

## 1. Rendering model

**A virtual DOM ([[DECISION-D17-RENDER-FUNCTIONS-VDOM]]).** Templates compile to a
`render()` returning a `ViewNode` tree; the runtime diffs it against the previous
tree and patches the DOM. The Go compiler only emits render functions; all
reactivity lives in the runtime (`data()` re-runs → new tree → diff), so the
runtime is testable with handwritten render functions and no compiler.
`PuzzleView` is a plain class, not a custom element, and there is no shadow DOM.

**The tree is not rebuilt whole ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]).** A
maximal static subtree is cached per owner (`this.__c[n]`, or `s.c[n]` in a loop
row) and returned by reference; an item-form `{#for}` is a persistent list block
(`listRows`) that returns a row's previous subtree unless its inputs changed.
`patch()` skips a subtree when both sides are the same object.

**`<puzzle-view>` (D20).** Views and layouts get a real `<puzzle-view>` root: the
boundary navigation swaps, `this.element` points at, and animations run on.
Components render inline with a single root and no wrapper. State lives on the
instance, never on the element.

## 2. Event listeners: per-node ([[DECISION-D18-PER-NODE-LISTENERS]])

`@click={ addTodo(event) }` compiles to a vnode attr; the ViewManager attaches it
to that element at mount and swaps or removes it on patch. Handlers are cached per
site (`this.__h`, or `s.h0` on a loop row), so they stay identity-stable and
listeners do not churn. There is no document-level delegation and no global event
bus: component → store → subscribed components is the path.

## 3. View states

```
created ──▶ loading ──▶ rendered ──▶ mounted ⇄ updating ──▶ destroyed
```

The full machine, with leaving and failure states, is [[STATE-VIEW-LIFECYCLE]].

- **created**: `created()` fires at the start of `mount()` (or `preload()` for a
  router-preloaded view), after class fields such as `events` exist.
- **loading**: `data(params, props)` runs inside `store.withTracking`; an async
  `data()` holds here. On first load a `<puzzle-skeleton>` renders at once
  ([[DECISION-D39-SKELETON]]) and `mounted()` fires against it. Without one,
  nothing shows until the first tree lands. On re-runs the previous render stays
  up; `loaded` latches on first commit.
- **rendered / mounted**: `mounted()` fires once, after the first real render is
  in the DOM, never on a view destroyed or leaving during its `data()` await. A
  `mounted()` throw destroys the instance; what fills its position depends on the
  owner ([[DECISION-D143-MOUNT-THROW-OWNERSHIP]]): a component position takes a
  placeholder the next parent patch refills (D115); a routed position keeps its
  committed URL and shows the app `errorView` or an invisible placeholder
  ([[DECISION-D145-ERROR-BOUNDARIES]]); a static-kernel root or a first-navigation
  takeover with no error view restores the prerendered content.
- **updating**: `beforeUpdate()` → patch → `afterUpdate(prev)`. `prev` is the
  frozen, shallow `{ props, params, route, data }` the previous render drew,
  captured as each render lands ([[DECISION-D178-AFTERUPDATE-PREV]]). A record in
  `prev.data` is the same live object as in the current data, so compare a field
  returned from `data()` instead.
- **destroyed**: unsubscribe, the ViewManager clears the subtree, refs go null,
  `destroyed()` fires (a throw is reported, never wedges teardown). Idempotent;
  `isDestroyed` reads true from then on.

## 4. Navigation state machine ([[DECISION-D19-NAVIGATION-COMMIT]])

```
push / replace / link click          popstate
            │                           │
            ▼                           ▼
MATCH route ── no match → catch-all `*`, else warn + stay (no token bump)
            │  token bumped only now
            ▼
GUARDS root → leaf, before any view exists:
       false/throw → stay; string → redirect via replace()
            ▼
LOAD   keep = shared chain-prefix length; instantiate fresh views [keep..N]
       (+ layout if its class changed); await fresh data(); PREPARE reused
       ancestors' data(). Skeleton views are not awaited.
            │  stale token → discard fresh views + prepared runs
            ├── keep === chain length (params/query only) ─────────┐
            ▼                                                      │
TRANSITION out: viewWillHide → out animation → viewDidHide         │
       → destroyed  (sequential default; overlap opt-in)           │
            ▼                                                      │
COMMIT (one synchronous block): pushState → title → mount ◀────────┘
       → router state → prepared ancestor commits
            ▼
mounted() → viewWillShow → in animation (not awaited) → viewDidShow → IDLE
```

The ordered steps and their guarantees are [[FLOW-NAVIGATION]]; the author
contract is [[DOC-SPEC-ROUTER]] §30. The rules that shape the diagram:

1. URL, title, history and the incoming mount commit together, so a failed,
   cancelled or superseded navigation leaves all of them untouched (D61).
2. Last navigation wins by token; the bump happens after the match, so an
   unmatched push can't strand a transition mid-`out`.
3. A `data()` rejection stays put: report through `onError`, destroy fresh views,
   discard prepared ancestors, restore a view stranded mid-`out`. A skeleton
   view's own failure (it is already on screen) shows the `errorView`.
4. Reused ancestors are prepared, not committed, until the navigation commits
   ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). A reused layout is patched,
   and its `data()` re-runs after the state commit, so it reads a fresh
   `router.current`.
5. One animator per transition: the topmost swapped instance; fresh instances
   below it skip their enter.
6. Every gated `preload()`/`refresh()` carries the navigation's frozen route
   snapshot as `this.route` ([[DECISION-D47-ROUTE-SNAPSHOT]]); `location` and
   `router.current` still hold the old route during LOAD.

## 5. What triggers a re-render

| Trigger | `data()` re-runs? | What happens |
|---|---|---|
| Store change matching a query this view made in `data()` | yes | batched flush → tracked re-run → diff/patch |
| Navigation reusing the view (new params/query) | yes | per §4; delivers the new `this.route` |
| Parent re-renders with changed props | yes | shallow compare; a store record prop also compares by render revision |
| Two-way bind write-back | yes | `setData` + `refresh`, or `record.update()` and its flush |
| Parent re-render with new slot content only | no | re-render with the existing model (once mounted) |
| `this.setData(...)` | no | state merged, one render scheduled per frame |
| Anything else (locals, direct DOM pokes) | no | not reactive by design |

Both paths batch on the shared frame scheduler (`scheduler.js`,
[[DECISION-D63-HIDDEN-TAB-FLUSH]]). Subscriptions reset on every `data()` run. A
child that takes a record prop and also queries it runs `data()` once per flush.
What a record prop and a list row observe: [[FLOW-REACTIVITY]],
[[DOC-SPEC-TEMPLATE]] §28. Waiting for this work: `this.renderTick()` for
scheduled renders ([[DECISION-D188-TICK]]), `app.idle()` / `ctx.idle()` for the
whole app ([[DECISION-D185-APP-IDLE]], [[DECISION-D189-AGENT-HOOKS]]).

## 6. Who owns what

| Concern | Owner |
|---|---|
| DOM creation, patching, listener attach/swap | [[COMPONENT-VIEW-MANAGER]] (the only code that touches the DOM) |
| View state, lifecycle hooks, update scheduling | [[COMPONENT-PUZZLE-VIEW]] |
| Subscriptions, change batching, records | [[COMPONENT-STORE]] |
| Navigation, matching, layouts and outlets, title/head | [[COMPONENT-ROUTER]] |
| `ctx` wiring (`store`, `router`, `formatters`, `idle`, plus `i18n` when configured) | [[COMPONENT-PUZZLE-APP]] |
