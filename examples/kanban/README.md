# Kanban Demo — Drag & Drop Reference for Puzzle

A minimal kanban board (3 columns, task cards) demonstrating **custom pointer-event
drag-and-drop** in Puzzle: a ghost card follows the cursor, a placeholder marks the
landing slot, neighboring cards FLIP-slide out of the way, and the drop commits to the
reactive datastore so every affected column re-renders from a single store flush.

This README doubles as the **reference for building drag-and-drop in any Puzzle app**.
Everything below was verified against the compiler and runtime source (paths noted).

```bash
# from the repo root
./puzzle dev examples/kanban --port 3456     # or: go run ./compiler/cmd/puzzle dev examples/kanban
```

## Why NOT native HTML5 drag-and-drop

Deliberate decision. The native API (`draggable`, `dragstart`, `drop`) cannot deliver
this UX:

- The drag image is a static bitmap snapshot — you can't style it mid-drag, animate it,
  or fix its offset behavior cross-browser.
- No smooth placeholder/shift behavior — `dragover` gives you coordinates, but the
  native ghost + drop-effect visuals fight any custom rendering.
- `dragover` fires continuously and requires `preventDefault()` bookkeeping; touch
  support is effectively nonexistent.

Pointer events (`pointerdown` / `pointermove` / `pointerup`) give full control and unify
mouse + touch + pen. Note: Puzzle's event system would support native DnD fine
(`@dragstart` etc. all compile) — it's the native API itself that's the dead end.

## Files

| File | Responsibility |
|---|---|
| `app/views/Board.pzl` | **All drag logic**: state machine, document listeners, ghost, hit-testing, FLIP hooks, drop commit |
| `app/components/TaskCard.pzl` | One card; renders placeholder mode when `task.__placeholder`; forwards `pointerdown` up via callback prop |
| `app/models/task.js` | `Task` model: `id` (string, primary), `title`, `status: 'todo'\|'doing'\|'done'`, `order` (number) |
| `app/app.js` | `PuzzleApp` config; seeds 8 tasks after `app.mount()` resolves |
| `app/styles/styles.css` | Theme + `.kanban-card { touch-action:none; user-select:none }`, `.kanban-placeholder`, `.kanban-ghost` |

## Verified framework facts (the load-bearing ones)

These were confirmed by reading compiler + runtime source. They are what makes custom
DnD possible with **zero framework changes**:

1. **Events are fully generic — no whitelist.** Any `@<name>={...}` template attr becomes
   a literal `el.addEventListener(name, fn)` at patch time
   (`client-runtime/views/viewManager.js` `setAttr`; lexer/parser/codegen never validate
   the event name). `@pointerdown`, `@pointercancel`, anything — all work.
2. **Handlers get the real DOM event, and loop vars pass through.** Two compiled forms
   (`compiler/internal/codegen/expr.go`, `compileEventValue`):
   `@click={ handler }` → `(event) => this.events.handler(event)`, and
   `@click={ handler(event, task.id) }` → `(event) => this.events.handler(event, task.id)`
   with `event` in scope. `event.preventDefault()` / `stopPropagation()` work normally.
   Constraint: the callee must be a bare name in the component's `events = {}` class
   field, and the value must be a single call expression (no member access, no arrows).
3. **`@name` on a *component* tag is a callback prop, not a listener** (D16). In this
   demo: `<TaskCard @grab={ startDrag(event, task.id) } />` compiles to a prop
   `grab: (event) => this.events.startDrag(event, task.id)`; TaskCard's own root div has
   the real `@pointerdown` and its handler calls `this.props.grab(event)`. That's how a
   card's pointerdown reaches the Board with the task id closed over.
4. **`findMany(type)` in `data()` subscribes to the whole type.** The subscription key is
   the record *type*, not the filter (`client-runtime/datastore/store.js`) — so a board
   that reads `findMany('task')` re-runs `data()` when **any** task changes. Moving a
   card between columns automatically re-renders both columns. Filters are applied
   after the fact, in JS.
5. **Store notifications batch into ONE `requestAnimationFrame` flush.** `_notify`
   accumulates keys in a Set; N `record.update()` calls in one tick → each subscriber
   notified at most once. The drop commit below issues up to ~10 updates and produces
   exactly one board re-render.
6. **`setData()` does NOT re-run `data()`.** It merges local state and schedules a
   re-render of the *old* model. If `data()` derives anything from local state (it does
   here — the placeholder position), you must call `this.refresh()` after `setData()`.
   `refresh()` re-runs `data()` **synchronously** when `data()` is sync, then patches.
7. **`beforeUpdate()` / `afterUpdate()` wrap every patch synchronously** (not the first
   mount): `beforeUpdate → patch → afterUpdate` in one tick (`PuzzleView._render`).
   This is exactly the FLIP contract — measure before, measure after, animate the delta.
8. **`{#for}` bodies are auto-keyed by `item.id`** — no key syntax exists; the codegen
   prepends `key: item.id` to the single root. **The body must be exactly ONE root
   element or component**, and `{#if}` may NOT be that root (codegen rejects it — see
   "Placeholder" below for the workaround).
9. **Keyed reconciliation is per-parent.** The differ matches/moves nodes by
   `(tag, key)` *within one parent's child list* (`viewManager.js` `patchKeyedChildren`).
   A card moving between two column containers is unmounted from A and freshly mounted
   in B — a new DOM node. Acceptable for kanban; if you ever need the same node to
   survive a cross-container move, all items must share one keyed parent.

## The core principle: two lanes

**Per-frame work stays imperative; only slot changes go through the reactive path.**

- **Fast lane (every pointermove, no re-render):** move the ghost via
  `ghost.style.transform = translate3d(...)`. The ghost is a `cloneNode(true)` appended
  to `document.body` — *outside* Puzzle's render tree, so patches never touch it and it
  never appears in FLIP measurements.
- **Slow lane (only when the target slot actually changes):** `setData({ targetCol,
  targetIndex }) + refresh()` → `data()` recomposes column arrays → keyed patch moves
  the placeholder → FLIP hooks animate every card that shifted.

Running ghost movement through `setData` would re-patch the board 60×/sec. Don't.

## Drag state machine

```
IDLE
  │ pointerdown on card (via TaskCard callback prop)
  │   guard: this._drag already set? return   ← multi-touch / re-entry protection
  │   guard: event.button !== 0? return       ← left button only
  │   record startX/Y, task id, source col+index (from store, ordered)
  │   body.userSelect='none', body.cursor='grabbing' (save prior values)
  │   add document listeners: pointermove, pointerup, keydown(Escape)
  │   event.preventDefault()
  ▼
PENDING            ← drag not yet real; clicks stay clicks
  │ pointermove: hypot(dx,dy) < 5px → ignore
  │              ≥ 5px → promote()
  ▼
DRAGGING
  │ promote(): re-resolve card el by [data-task-id] (never trust a stale node ref),
  │   getBoundingClientRect, cloneNode(true) → ghost on document.body
  │   (position:fixed, exact width/height, margin:0, pointer-events:none,
  │    z-index:9999, rotate(3deg) scale(1.03), shadow)
  │   record pointer offset within the card (so the grab point stays under the cursor)
  │   record dragHeight = card height (placeholder matches it exactly)
  │   publish drag state + refresh()  ← card leaves the flow, placeholder appears
  │
  │ every pointermove:
  │   moveGhost()                       (fast lane)
  │   hitTest(x,y) → { col, index }     (see below)
  │   if slot changed → publish + refresh()   (slow lane → FLIP)
  │   outside all columns → col=null → placeholder hidden, drop would cancel
  ▼
pointerup, targetCol set   → DROP:   commit to store, cleanup()
pointerup, targetCol null  → CANCEL: store untouched, cleanup()  (card snaps home)
Escape                     → CANCEL: same
view destroyed mid-drag    → cleanup()  (safety net in destroyed())

cleanup(): remove the 3 document listeners (keep the exact bound fn refs as instance
fields!), remove ghost from body, restore userSelect/cursor, null the drag state,
refresh() → board re-renders without the placeholder.
```

### Why document listeners, not `setPointerCapture`

The moment the drag starts, the source card is **removed from the DOM** (filtered out of
the column array, replaced by the placeholder). Pointer capture dies with the captured
element — you'd silently stop receiving `pointermove`. Document-level listeners are
immune to any re-rendering underneath. This is the #1 trap in this design.

## Hit-testing (and the feedback-loop trap)

```js
// column: containment test against each [data-column] container's rect
// index:  count real cards in that column whose vertical midpoint is above pointer y
const cards = column.querySelectorAll('[data-task-id]');
// ⚠ EXCLUDE the placeholder from measurement:
//   .filter(el => el.dataset.taskId !== '__ph__')
```

**The trap:** if you measure midpoints *including* the placeholder, inserting it shifts
every midpoint below it, which changes the computed index, which moves the placeholder,
which shifts the midpoints… → flicker loop. Measuring only real cards keeps the geometry
stable no matter where the placeholder currently sits. (The dragged card is already out
of the flow, so it can't perturb anything either.)

Live `getBoundingClientRect` per move is fine at demo scale and stays correct under
scrolling. If boundary jitter ever shows, add ±6px hysteresis before accepting a slot
change. Give `[data-column]` containers a `min-height` so **empty columns** are still
valid drop targets.

## The placeholder (and the `{#for}` root constraint)

You cannot write `{#for ...}{#if ...}…{/if}{/for}` — the for-body root must be one
element/component. So the placeholder is a **pseudo-item spliced into the data**:

```js
// Board data(): after bucketing tasks by status and sorting by order —
if (drag.dragging) {
  every bucket = bucket.filter(t => t.id !== drag.draggingId);     // card leaves the flow
  if (drag.targetCol)
    buckets[drag.targetCol].splice(clampedIndex, 0,
      { id: '__ph__', __placeholder: true, height: drag.dragHeight });
}
```

TaskCard then branches *inside* its single root:

```html
<div class="kanban-card mb-3" data-task-id={ task.id } @pointerdown={ down(event) }>
  {#if task.__placeholder}
    <div class="kanban-placeholder" style="height:{ task.height }px"></div>
  {:else}
    <article class="kanban-card-body">…</article>
  {/if}
</div>
```

Bonuses of this shape:
- The placeholder is keyed (`__ph__`) like any item, so moving it **within** a column is
  a keyed *move* → FLIP animates it sliding. Crossing columns remounts it → it gets the
  entering animation instead.
- Its height equals the measured dragged-card height, so the gap is exact.
- Guard `events.down` with `if (this.props.task.__placeholder) return;` — never grab it.

## FLIP shift animation

```js
beforeUpdate() {                       // fires synchronously before every patch
  this._rects = snapshot of getBoundingClientRect for all [data-task-id] els, by id;
}
afterUpdate() {                        // fires synchronously after the patch
  for each [data-task-id] el:
    no previous rect?  → entering (placeholder appeared): fade/scale-in ~140ms
    rect moved >0.5px? → el.animate(
        [{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }],
        { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' })
}
```

- Works for *every* cause of movement: placeholder relocation mid-drag, the drop
  settling, and the cancel snap-back — they're all just patches.
- **Keep cards free of CSS `transform`/`transition` (incl. Tailwind `hover:scale-*`)**
  — stylesheet transforms fight the WAAPI animation.
- The ghost lives on `document.body`, outside `this.element`, so the querySelectorAll
  sweeps never see it.
- This only works because `refresh()` patches synchronously between the two hooks
  (fact #7). Cross-column-moved cards remount as new nodes (fact #9) and simply appear
  — only their *neighbors* animate. Fine in practice; the ghost covers the moment.

## Drop commit — the store-sync story

```js
// target column: real tasks (dragged excluded), sorted by order
targetTasks.splice(targetIndex, 0, dragged);
targetTasks.forEach((t, i) => t.update({ status: targetCol, order: i }));
// cross-column? reindex the source column the same way
```

- `order` is a plain integer reindexed per affected column on every drop. Simple and
  deterministic. (At real-app scale you might use fractional/sparse ordering to write
  only one record — overkill for a demo.)
- All `update()` calls coalesce into **one rAF flush** (fact #5); the board — subscribed
  via `findMany('task')` (fact #4) — re-runs `data()` once, and FLIP settles both
  columns in a single pass. **No manual "which columns changed" bookkeeping exists
  anywhere.** That's the demo's whole point.
- The CANCEL path never touches the store: clearing local drag state + `refresh()`
  restores the pre-drag order from the untouched records.

## Gotcha checklist (all hit or preempted while building this)

- [ ] `setPointerCapture` dies when the dragged element is removed from the DOM → use
      document listeners.
- [ ] Guard `startDrag` re-entry (`if (this._drag) return`) — a second pointerdown
      mid-drag (multi-touch) would overwrite state and leak the ghost.
- [ ] `setData()` alone won't recompute `data()` — pair with `refresh()`.
- [ ] Exclude the placeholder from hit-test measurement (feedback loop).
- [ ] `{#if}` can't be a `{#for}` body root — branch inside the item component.
- [ ] `.kanban-card { touch-action:none; user-select:none }` in CSS **and**
      `preventDefault()` on pointerdown **and** `body.userSelect='none'` during the
      drag — all three, or you'll get text selection / touch scrolling mid-drag.
- [ ] 5px movement threshold before the drag becomes real — keeps clicks clickable.
- [ ] Left-button only (`event.button === 0`).
- [ ] Store bound listener refs (`this._onPointerMove = (e) => …` in `created()`) so
      `removeEventListener` actually removes them.
- [ ] `cleanup()` from `destroyed()` too — navigation mid-drag must not strand a ghost
      or document listeners.
- [ ] Restore `body.userSelect` / `body.cursor` to their *saved prior values*, not `''`.
- [ ] No `animations = { in, out }` field on the card component — the source card must
      vanish instantly under the ghost, and enter/leave animations would fight the FLIP.
- [ ] Ghost gets `pointer-events:none` — otherwise it hit-tests against itself.
- [ ] `{#for}` keys are always `item.id` — records need stable string ids for keyed
      moves to work.

## Reusable recipe (porting DnD to another Puzzle app)

1. Model needs a stable `id`, a "container" field (here `status`), and an `order` number.
2. One owner view holds all drag logic; item components forward `@pointerdown` up via a
   callback prop with the item id: `@grab={ startDrag(event, item.id) }`.
3. Copy the state machine (IDLE → PENDING → DRAGGING → DROP/CANCEL), the two-lane rule,
   the hit-test-excluding-placeholder, the FLIP hooks, and the cleanup discipline from
   `app/views/Board.pzl` — they're all in one file on purpose.
4. Drop = a handful of `record.update()` calls; the store's rAF batching and
   type-level subscriptions do the rest.

Out of scope here (known extensions): auto-scroll when dragging near container edges,
scrollable columns (hit-testing already survives scroll; auto-scroll doesn't exist),
touch-hold-to-drag delay, cross-container node persistence, multi-select drag.
