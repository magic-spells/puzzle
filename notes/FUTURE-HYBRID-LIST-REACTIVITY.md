# Future idea: hybrid list reactivity

**Status:** brainstorm / future idea (not scheduled)  
**Captured:** 2026-07-27  
**Context:** Architecture review of `findMany` collection fan-out, comparison with Solid-style list updates.

## Problem

Puzzle’s data path is streamlined:

```text
Model → Store → data() → view model → render() → ViewNode tree → patch
```

That is a strength for app structure. The downside on large lists:

1. `findMany(type)` subscribes at **collection (type)** granularity.
2. Any single-record field mutation notifies the type key.
3. Every list owner re-runs `data()`, rebuilds a full ViewNode list, then keyed-patches.

Keyed reconciliation already reuses DOM for add/remove/move when the parent *does* re-render. The cost is **parent invalidation and VDOM allocation**, not necessarily full DOM thrash.

Stress/benchmarks already show: virtualizing bounds DOM, but **does not** bound collection-query work.

## Inspiration (Solid)

Solid does not rebuild a full VDOM for field updates.

- `<For each={list}>` keeps a **key → live DOM row** map.
- Structural changes (add/remove/reorder) reconcile that map only.
- Field changes re-run **only effects that read that path**, which already close over the row’s DOM nodes.

Linking “record ↔ DOM” is not a global registry: it is **lexical + map** — created when the row mounts, disposed when the row leaves.

Filtering is typically:

```js
const filter = createSignal('open');
const visible = createMemo(() => /* filter source list */);
// <For each={visible()}> … </For>
```

Membership changes → `<For>` reconcile. Same membership, field change → row bindings only.

## Idea: hybrid for Puzzle

Keep Puzzle’s pipeline (no full “become Solid”), but split work:

```text
Parent list (structure):
  - care about membership + order (ids)
  - same ids, same order → do nothing (cheap)

Each row (content):
  - own a component instance (or future row scope)
  - subscribe to its record (findOne / type+id)
  - field change → refresh/patch that row only
```

### What is already easy

- **Add / remove / move** with keys: ViewManager keyed recon already does this when given a new child list.
- **Row-level store precision:** `findOne(type, id)` subscribes to `type + id`, not the whole collection.
- **Component prop bailout:** stable primitive props (`id`) + `shallowEqual` can skip parent-driven child refresh; the changed row can still wake via its own `findOne` subscription.

### What is missing (the real win)

Stop waking the **list parent** on pure field mutations of members.

Today: field update → type notify → every `findMany` owner re-runs.

Ideal: field update → type+id notify only → row owners re-run; list owners sleep unless membership/order changed.

## Layers of ambition

### Layer 1 — App pattern (works today, partial)

```html
{#for todo in todos}
  <TodoItem id={todo.id} />
{/for}
```

```js
// Parent data()
return { todos: this.ctx.store.findMany('todo') };

// TodoItem data(_, props)
return { todo: this.ctx.store.findOne('todo', props.id) };
```

- Prefer **id props**, not whole records, when parent still re-renders.
- Virtualize large lists.
- Parent still pays O(n) `findMany` + list VDOM on every type mutation; children that only `findOne` don’t all re-run `data()` unless notified.

### Layer 2 — Store invalidation split (high leverage, Puzzle-shaped)

| Event | Notify |
| --- | --- |
| create / destroy / membership change | type (collection) |
| field update on existing id | type + id only |

Then:

- `findMany` parents wake on structure only.
- `findOne` rows wake on their record’s fields.
- Parent “same order → no-op” becomes free: **it simply is not notified.**

**Open design issue — aggregates:**

```js
data() {
  const todos = this.ctx.store.findMany('todo');
  return {
    todos,
    openCount: todos.filter((t) => !t.done).length, // needs field awareness
  };
}
```

If type is not notified on `done` toggles, `openCount` goes stale unless:

- aggregates use an explicit API / revision,
- or `data()` tracks which fields were read (finer grained),
- or docs require a deliberate subscription for aggregates.

Also worth considering: stable `findMany` array identity when the id set + order is unchanged (helps memo/bailout even if parent still runs).

### Layer 3 — Per-iteration reactive scopes / direct DOM writes (Solid-like)

Compiler treats `{#for}` body as a row island with bindings like “write this text node from `todo.text`.”

- Full win for **inline** loop bodies (not only components).
- Large shift: compiler + runtime + mental model.
- Outside data in the loop body (`user.name`, parent `filterLabel`) means the row is not only subscribed to the list item — needs multi-read tracking or props from parent.

Prefer Layer 2 first; treat Layer 3 as optional later.

## Inline `{#for}` vs component rows

| Shape | Hybrid friendliness |
| --- | --- |
| `<TodoItem id={todo.id} />` | High — clear ownership boundary, `findOne` fits |
| Inline markup in parent template | Low today — body is part of parent `render()`, not its own reactive scope |

Pragmatic cut line: **component boundary = fine-grained unit** until/unless the compiler owns for-body islands.

## Parent early-out vs not notifying

| Approach | Mechanism | Cost on field change |
| --- | --- | --- |
| A. Don’t notify parent | membership vs field notify | ~0 parent work |
| B. Notify parent, early-out | compare id sequence / revision | O(n) compare, skip render if equal |

A is better when semantics allow. B is a safety net if parents might depend on fields.

“Same ids + order” alone is only correct if parent UI is a pure function of **membership + order**, not of item fields.

## Explicit non-goals (for this idea)

- Not replacing VDOM with signals framework-wide.
- Not requiring `count` / `setCount` local cells for domain data.
- Not incremental list ops from the store as the first step.
- Not true hybrid SSG DOM-adoption hydration (separate idea).

## Related ceilings (same review thread)

- Global async `data()` serialization via `Store.withTracking` / `_asyncTrackingChain` — concurrent dashboard loads queue.
- Hybrid/static takeover remounts DOM instead of hydrating (intentional).
- Full ViewNode rebuild each render is expected VDOM tradeoff; list fan-out is the higher-ROI list issue.

## Suggested direction if revisited

1. Document Layer 1 list patterns (id props, `findOne` rows, virtualize).
2. Design Layer 2 notify split + aggregate story (decision card if SPEC-facing).
3. Measure with existing stress/benchmark list ops (select-row / update-every-10th at 10k).
4. Only then consider compiler for-body islands (Layer 3).

## One-line summary

**Keep Model → Store → `data()` → view; invalidate the right view instance.** List parents own structure; row components own fields. That is most of Solid’s list win without becoming Solid.
