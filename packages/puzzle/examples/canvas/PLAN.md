# Puzzle Studio — plan & roadmap

The condensed build plan for this example. The full brainstorm (framework
feasibility, multiplayer transport analysis, free-hosting options) lives in
[notes/canvas-studio-plan.md](../../notes/canvas-studio-plan.md); this file
tracks what's shipped here and what's deliberately left for later.

## Shipped

- **Phase 1 — static editor.** Element model (`rect`/`ellipse`/`text`/
  `frame` in one `element` record type), seeded scene, click/shift
  selection, layers tree, toolbar create, keyboard (nudge, delete,
  duplicate, escape), and a live inspector: position/size, fill swatches,
  opacity, corner radius, shadow presets, text content/size, frame layout
  (free / stack-v / stack-h with gap + padding), z-order, delete.
- **Phase 2 — direct manipulation.** Pointer state machine (threshold
  drag): multi-select group move via a non-interactive ghost layer,
  8-handle resize, marquee select, Escape cancel. rAF-batched ephemeral
  state; store writes on drop only.
- **Phase 3 — frames.** Drop-into-frame reparenting with coordinate
  rebase, drag-out to the stage, stack-frame reorder with a live
  placeholder gap, drop-target highlight.

All of it on shipped v1.x framework surface — zero framework changes were
needed, as the plan predicted.

## Deliberately not built (yet)

- **Pan / zoom** (plan Phase 4). The stage is a fixed 2400×1600 world at
  1:1. Zoom touches every pointer→stage coordinate conversion, so it's an
  isolated later layer (`geometry.js` is where the screen↔world transform
  would live).
- **Nested frames.** Frames are one level deep — children are leaf shapes.
  Nesting mostly needs recursive rendering + recursive reparent math.
- **Multiplayer** (plan Phase 5). The store is the seam: inbound remote ops
  are just `createRecord`/`update()`/`destroy()` calls (works today);
  outbound needs a public `store.onChange` hook with an `origin` tag —
  a small framework amendment proposed in the notes plan. First transport:
  BroadcastChannel (two tabs, zero deps); public rooms later via a small
  room server (Durable Objects / PartyKit) or Firebase RTDB — analysis in
  the notes plan.
- Smaller ideas: snap-to guides, inline text editing on the canvas,
  multi-select resize, undo (a natural fit for the same `store.onChange`
  hook multiplayer needs).

## Gotchas hit while building (worth knowing before extending)

1. **A `{#for}` body must have a single element/component root.** Wrap
   multi-node or `{#case}`/`{#if}` bodies in `<div class="contents">` —
   `display:contents` creates no box, so absolutely-positioned children
   still resolve against the stage/frame.
2. **Template text nodes don't decode HTML entities** — write `&`, not
   `&amp;`.
3. **Resize grips must `stopPropagation()`** on pointerdown, or the press
   bubbles to the stage handler and starts a marquee. Overlay root stays
   `pointer-events-none`; only grips re-enable pointer events.
4. **Two document `keydown` handlers coexist** (permanent editor keys +
   per-gesture Escape). The permanent one must early-return while a gesture
   is active or Escape both cancels the drag and clears the selection.
5. **The layers panel needs its own drag-stable tree.** The canvas tree
   lifts dragged elements into the ghost layer; reusing it made layer rows
   vanish mid-drag.
6. **Ghost nodes carry `pointer-events:none` in their css** so the
   (data-driven) drop-target hit-test is never occluded by the thing being
   dragged.
7. **Never `record.update()` during pointermove.** Ephemeral gesture state
   goes through `setData()` + one rAF per frame; the drop commits. Same
   rule the orrery example documents for its animation loop.
