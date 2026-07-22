---
name: VIEW_LIFECYCLE.md — frontend runtime map
status: verified
verified_at: '2026-07-22T00:04:06.267Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - FLOW-REACTIVITY
  - DOC-SPEC
  - DOC-DECISIONS
  - DOC-ROUTER
---

> The consolidated map of how the frontend works end to end (settling D17–D19): the vdom rendering model, per-node event listeners, the component and navigation state machines, and the complete re-render trigger table. Acceptance spec for [[COMPONENT-PUZZLE-VIEW]] and the router's navigation pipeline.

# View Lifecycle & Frontend Runtime Map

Internal design doc — see [[DOC-SPEC]] for the product contract. This document consolidates **how the frontend actually works end to end**: the rendering model, the event-listener strategy, component states, the navigation state machine, and exactly what triggers a re-render. Decisions here are logged as [[DOC-DECISIONS]] D17–D19.

---

## 1. Rendering model: a virtual DOM (Vue-style)

**Puzzle uses a virtual DOM — the same update mechanism as React and Vue**: render functions return trees of plain objects, the runtime diffs against the previous tree and patches the real DOM. Nothing exotic. What actually differs between frameworks is *where the render function comes from and how much the compiler must understand* — and on that axis Puzzle sits exactly where Vue does (templates compile to render functions; all reactivity stays in the runtime):

| | Web components (shadow DOM) | **Puzzle** | Svelte |
|---|---|---|---|
| Template becomes | custom element + shadow root | **a render function returning a ViewNode tree** | imperative DOM update code per binding |
| Updates via | browser internals | **runtime diff/patch of vdom trees** | compiled fine-grained mutations |
| Compiler complexity | low | **low — templates only** | high — per-binding dependency tracking |
| Styling | scoped by shadow boundary | **Tailwind/global CSS + opt-in native `@scope`** | compiler-scoped CSS |

**No shadow DOM (D17).** `PuzzleView` is a plain class — not an `HTMLElement`, no `customElements.define`, no shadow roots. Rationale: shadow boundaries would break the Tailwind-first styling story (global utility CSS can't pierce shadow roots), complicate event bubbling, and buy nothing — component isolation comes from the vdom (each component renders and patches only its own subtree), not from the DOM.

**Not Svelte-style compiled updates (D17).** Svelte's approach moves reactivity analysis into the compiler — every `{ expr }` needs compile-time dependency tracking to know which DOM node to touch when which variable changes. That is precisely the compiler complexity Puzzle avoids: our Go compiler only parses templates and emits render functions; **all** reactivity lives in the runtime (`data()` re-runs → new tree → diff). The trade is a diff cost per update in exchange for a radically simpler compiler and a runtime that can be tested without any compiler at all (compiler-independent runtime fixture tests depend on this).

**What `<puzzle-view>` is at runtime (D20):** for router-mounted **views and layouts**, it's a real DOM element — the view boundary that navigation swaps, `this.element` points at, and animations run on (v1.1 — `element.animate(...)` needs no custom element). **Reusable components render inline** — no wrapper element — so nested components (`view → <TodoItem> → <Button>`) never stack wrappers or disturb flex/grid layouts. In component files, `<puzzle-view>` is just the template delimiter. Either way the JS class and the DOM stay *paired, not fused*: state lives on the `PuzzleView` instance, which holds the element reference — never on the element itself, where a DOM detach would destroy it.

The pipeline for one component:

```
template (.pzl)          compile time (Go compiler)
    │  Go compiler: parse template, emit render fn
    ▼
Component.prototype.render = function () {
  return new ViewNode('div', {...}, [...])   // reads this.getData(), this.events
}
    │  runtime, every update
    ▼
ViewManager.render(tree)   →  diff vs previous tree  →  patch real DOM
```

## 2. Event listeners: per-node, not document-level delegation (D18)

**Decision: v1 attaches real listeners on the elements that declare them.** A template `@click={ addTodo(event) }` compiles to a vnode attr `'@click': (event) => ...`; the ViewManager `addEventListener`s it on that element at mount and swaps/removes it on patch (leak-free — covered by tests).

Older docs promised a single document-level listener that routes events to subscribed views. That model was **considered and rejected for v1**:

- Its benefits (fewer listeners on huge lists, listeners surviving DOM moves) don't materialize at v1 scale — listener count is bounded by visible DOM, and our keyed patcher already moves nodes *with* their listeners.
- Its costs are real: a routing layer matching `event.target` up the tree against handler registries, special-casing non-bubbling events (`focus`, `blur`, `mouseenter`), and murkier `stopPropagation` semantics.
- Nothing in the component API would change if we switched later — `events = {}` and `@event={...}` are delegation-agnostic — so this is revisitable post-v1 behind the same template syntax if profiling ever demands it.

There is **no global event bus** in v1 (SPEC cut list). Component → store → subscribed components is the communication path.

## 3. Component states

A component instance moves through:

```
created ──▶ loading ──▶ rendered ──▶ mounted ⇄ updating ──▶ destroyed
            (data()      (first       (hook)     (re-runs /
             awaited)     tree)                    setData)
```

- **created** — constructor ran, `created()` hook fired. Class fields (`events`) are now initialized; the runtime reads `this.events` lazily *after* this point, never in the base constructor.
- **loading** — `data(params, props)` runs inside `store.withTracking(component, ...)`; if async, the component holds here until it resolves. On first load, a declared `<puzzle-skeleton>` renders immediately and is swapped for the real tree when the data commits (v1.8, D39; `mounted()` then fires against the skeleton DOM and the swap is bracketed by `beforeUpdate`/`afterUpdate`); without one, nothing is shown until the first tree lands. On *re*-runs the previous render stays visible until the new tree is ready — a skeleton never reappears (`loaded` latches on the first commit).
- **rendered / mounted** — first tree rendered into the container; `mounted()` fires after DOM insertion.
- **updating** — either trigger (see §5) produces a new tree; `beforeUpdate()` → patch → `afterUpdate()`.
- **destroyed** — `store.unsubscribe(component)`, ViewManager clears its subtree, `destroyed()` fires. Idempotent.

## 4. Navigation state machine (D19)

```
        router.push(path) / link click            popstate (back/forward)
                 │                                        │
                 ▼                                        ▼
IDLE ──▶ MATCH route (fail → catch-all `*` route, else warn + stay, URL untouched)
                 │
                 ▼
         LOAD: diff old vs new route chain → keep = shared-prefix length;
               instantiate fresh views [keep..N] (+ layout if changed);
               await every fresh + reused-ancestor data(params)
                 │  (a newer navigation cancels this one — nav token check)
                 ▼
         TRANSITION out (sequential default, v1.1 — D28):
           old view viewWillHide() → out animation → viewDidHide() → destroyed()
                 │  a navigation superseded or failed HERE commits nothing (D61);
                 │  overlap mode (v1.24 — D56) starts the out and falls through
                 │  without awaiting it
                 ▼
         COMMIT (atomic, D19 + D61): pushState → document.title → mount — one
                 synchronous block; URL, title, DOM and router state land together
                 │
                 ▼
           new view rendered + mounted() → viewWillShow() → in animation → viewDidShow()
           (the in animation is non-blocking — IDLE is reached without awaiting it)
                 │
                 ▼
                IDLE
```

The ordering decisions, each fixing an audited prototype bug:

1. **URL commits with the render, not before.** For `push()`, `pushState` happens only after `data()` resolves — and, since v1.28 (D61), in the same synchronous block as the incoming mount (after the outgoing `out` animation in sequential mode) — so a failed, cancelled, or superseded navigation leaves URL, title, history, and view all untouched (the prototype pushed first, desyncing URL from view on failure; v1.1–v1.27 pushed before the out animation, leaving a supersession window D61 closed). For `popstate` the browser has already moved the URL; on load failure we log and keep the current view — accepted asymmetry.
2. **Rapid navigation cancels cleanly.** Each navigation takes a monotonic token; when a `data()` await resolves for a stale token, its result is discarded. Last navigation wins.
3. **`data()` rejection = stay put.** The error is logged, the current view remains, no history entry is created. Error-page conventions are post-v1.
4. **404 via catch-all route.** A route with `path: '*'` (checked last, regardless of definition order) receives unmatched URLs. Without one, the router warns and stays. This replaces the previously open question in [[DOC-ROUTER]].
5. **Layout reuse.** If the next route uses the *same layout class*, the layout instance is kept — its `data(params)` re-runs and it re-renders (patch, not remount), and only the `<Slot/>` content swaps. A different layout class remounts the whole tree. This is what makes persistent headers/sidebars not flash on navigation.
6. **Sequential transition animations (v1.1 — D28).** The transition plays in order: the old view's `out` animation → destroy → COMMIT (URL + title, atomic with the mount — point 1, D61) → mount the (already-preloaded) new view → the new view's `in` animation. Four no-op lifecycle hooks bracket the phases — `viewWillHide()`/`viewDidHide()` around `out`, `viewWillShow()`/`viewDidShow()` around `in` — and fire **in order even when a view declares no `animations`** (zero-duration semantics). The `in` animation is fire-and-forget, so navigation does not block on it. One animator per transition: a view swapped inside a **reused** layout animates alone; a **layout swap** animates the layout as the unit (its view rides along). Cross-fade/overlapping transitions shipped in v1.24 (D56): `transitionMode: 'overlap'` pins the leaver in place (inline `position: fixed` at its measured rect — the positioning strategy) and runs old-`out` and new-`in` concurrently, with the leaver torn down on its own out-settle; sequential stays the default. Full contract: [[DOC-SPEC]] §12 and §26.
7. **The route snapshot rides the LOAD phase (v1.15 — D47).** Every gated `preload()`/`refresh()` in the LOAD box carries this navigation's frozen route snapshot (`refresh({ params, route })`), stored on the instance and read as `this.route` in `data()` — the only route source that describes the navigation being gated (in the LOAD phase, `location` and `router.current` still hold the OLD route; that's the point of the gate). One ordering nuance shipped with it: a **reused layout's** post-commit chrome refresh now runs *after* the internal state commit, so `router.current` read from a layout `data()` is never stale either. Full contract: [[DOC-SPEC]] §19, [[DOC-DECISIONS]] D47.
8. **Chain-prefix reuse for nested routes (v1.3 — D30).** With `children` routes (SPEC §9), a route resolves to a **chain** of view instances (root → leaf) hosted through each level's `<Slot/>`, under one top-level layout. Navigation diffs the old and new chains by route-node identity and keeps the shared prefix: `keep` = shared-prefix length. Fresh views `[keep..N]` preload; **reused** ancestor views `[0..keep-1]` re-run `data(params)` with the **full merged params** and — being routed content, not chrome — are **awaited before the URL commits** (point 1, generalized). The old flat params-only case is just `keep === chain length` (whole chain refreshes, zero new instances). Layout reuse (point 5) is the special case at depth 0 — a layout can only swap when `keep === 0`; any deeper divergence necessarily reuses the layout. The one-animator rule (point 6) generalizes: the **animator is the topmost swapped instance** (`views[keep]`), and every fresh instance below it is `skipEnter()`'d so the subtree doesn't animate all at once. A rejection or superseded token anywhere destroys the fresh instances only and leaves reused ancestors (and the URL) untouched. Full contract: [[DOC-DECISIONS]] D30, [[DOC-ROUTER]].

## 5. What triggers a re-render — the complete table

| Trigger | `data()` re-runs? | What happens |
|---|---|---|
| Store record created/updated/destroyed, matching a query this component made in `data()` | **yes** | batched flush → `withTracking` re-run → new tree → diff/patch |
| Route params change (navigation to same view, new `:id`) | **yes** | router re-runs `data(params, props)` per §4 — the call also delivers the navigation's route snapshot (`this.route`, v1.15 D47) |
| Parent re-renders with changed props | **yes** | child `data()` re-runs with new props |
| `this.setData(...)` | **no** | state merged, re-render scheduled (rAF-batched) with existing model |
| Anything else (local variables, direct DOM pokes) | no | nothing — not reactive by design |

Two flushes exist and both batch: the **store flush** (many record changes → each subscribed component notified once) and the **view update scheduler** (many `setData` calls → one re-render). A store notification and a `setData` in the same frame produce one `data()` re-run + one patch, not two.

Subscriptions reset on every `data()` re-run: the component is subscribed to exactly what its *latest* `data()` actually queried — a filter change that stops querying a record stops those notifications automatically.

## 6. Who owns what

| Concern | Owner |
|---|---|
| DOM creation, patching, listener attach/swap | ViewManager (only code that touches the DOM) |
| Component state, lifecycle hooks, update scheduling | PuzzleView |
| Subscriptions, change batching, model instantiation | Store |
| Navigation, route matching, layout/Slot composition, `document.title` | Router |
| `ctx` (`store`, `router`, `formatters`) wiring | PuzzleApp |

---

*Settled by D15–D19: plain-class PuzzleView, component composition via default marker (`<children/>` since v1.41/D74, spelled `<slot/>` originally) + callback props, vdom rendering, per-node listeners, and the navigation state machine. No frontend-architecture questions remain open for the 0.1 release.*
