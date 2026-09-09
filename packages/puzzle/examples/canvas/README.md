# Puzzle Studio (examples/canvas)

A mini-Figma: a canvas studio where you drag shapes and frames around a
stage, select them, and edit their options — fill, opacity, corner radius,
shadow, text, and frame layout (free / vertical / horizontal stack, the
mini auto-layout) — in a live inspector. Dark design-tool chrome: toolbar
on top, layers tree on the left, dot-grid stage in the middle, inspector on
the right.

Where `examples/kanban` demos one drag interaction and `examples/orrery`
ties the store to a `<canvas>` loop, this app is the **direct-manipulation
stress test**: a full pointer-gesture state machine (move / resize /
marquee / reorder) layered over pure store-driven rendering. The core
pattern throughout: **the store is the document, gestures are ephemeral** —
pointer moves publish through `setData()` + rAF batching and only the drop
commits `record.update()` writes.

## Run it

```bash
puzzle dev examples/canvas      # from the repo root: go run ./compiler/cmd/puzzle dev examples/canvas
```

Then open the dev server URL. Production bundle:

```bash
go run ./compiler/cmd/puzzle build examples/canvas
```

## Try this

- Drag the **Sun** into the **Palette** frame — it nests. Drag a swatch out
  onto the stage — it un-nests. A hovered drop-target frame shows a dashed
  accent outline.
- In the **Profile card** (a `stack-v` frame), drag **Title** below
  **Subtitle** — a placeholder gap tracks the insertion point, and the drop
  reorders the stack.
- Select the Profile card and switch its **Layout** to `Stack →` in the
  inspector, then play with **Gap** and **Padding** — auto-layout reflows
  live because the positions are a pure function of the records.
- Marquee across empty stage to multi-select; shift-click adds; drag any
  selected element to group-move; `Esc` mid-drag cancels with no writes.
- Keyboard: arrows nudge (shift = 10px), `⌫` deletes, `⌘/Ctrl-D`
  duplicates.

## What each piece demonstrates

| Feature | Where |
| ------- | ----- |
| Ephemeral gesture state vs store commits (the kanban pattern, generalized) | `app/views/Editor.pzl` — `_drag` machine (PENDING → DRAGGING → drop/cancel), rAF-batched `setData` publish, store writes only in `_commitMove`/`_commitResize` |
| Reactive fan-out from `record.update()` | `app/components/Inspector.pzl` — every slider/swatch writes the record; canvas, layers panel, and overlay all re-render from the store subscription |
| Pure derivation in `data()` | `Editor.pzl` `data()` — render tree, ghost layer, drop-target flag, overlay bounds, and marquee box all derived from records + ephemeral state, no side effects |
| Component callback props (single-payload convention) | `CanvasShape`/`CanvasFrame` → `this.props.press({ event, id })`; `SelectionOverlay` → `resize({ event, dir })` |
| `{#case}` multi-branch (v1.7) | stage node dispatch in `Editor.pzl`; element type dispatch in `CanvasShape.pzl` |
| Attribute expression binding `attr={ expr }` | `style={ node.css }` everywhere — style strings composed in `app/lib/geometry.js` |
| Frame stack layout (positions as pure functions) | `placeChildren()` in `app/lib/geometry.js` + the frame branch of `Editor.data()` |
| Layers tree + inspector as independent store projections | `LayersPanel.pzl` (stable tree, survives mid-drag), `Inspector.pzl` |
| Document-level listeners with clean teardown | listeners attach on press, single `_cleanup()` for drop/Escape/`destroyed()` |

## Architecture notes

- **One interaction owner.** All pointer/keyboard state lives in
  `Editor.pzl`; the render components (`CanvasFrame`, `CanvasShape`,
  `SelectionOverlay`) are dumb projections of the node objects `data()`
  builds. `app/lib/geometry.js` is pure math — placement, hit-testing,
  bounds, style strings — with no framework imports.
- **Ghost layer.** While moving, dragged elements are lifted out of the
  normal tree and re-rendered with `pointer-events:none` so the drop-target
  hit-test is data-driven and the dragged node never occludes its target.
- **Frames don't nest** (one level deep) and the stage is 1:1 scale —
  pan/zoom and nested frames are future work; see [PLAN.md](./PLAN.md).

Gotchas discovered while building (single-root `{#for}` bodies,
`display:contents` wrappers, grip `stopPropagation`, the drag-stable layers
tree) are written up in [PLAN.md](./PLAN.md).
