---
name: Puzzle Studio (examples/canvas) — the direct-manipulation canvas editor
kind: reference-app
status: built
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - COMPONENT-CODEGEN
  - DECISION-D191-SET-STATE-GET-STATE
  - DECISION-D184-STORE-OBSERVE
  - DECISION-D37-CASE-WHEN
  - DOC-EVENTS
  - DOC-SPEC-TEMPLATE
  - FLOW-REACTIVITY
---

# Puzzle Studio (examples/canvas)

A small design-tool editor: frames and shapes on a dot-grid stage, a layers tree and an inspector. It is the direct-manipulation example: move, resize, marquee and stack-reorder gestures over store-driven rendering. The store is the document and a gesture is ephemeral: it lives in `setState`, and only a drop or a keyboard nudge writes records. Tour and file map: `examples/canvas/README.md`.

## Running it

```bash
# from packages/puzzle
go run ./compiler/cmd/puzzle dev examples/canvas
go run ./compiler/cmd/puzzle build examples/canvas
```

## Structure

- `app/views/Editor.pzl` owns all pointer and keyboard state. Its `data()` builds the canvas tree, the ghost layer, the layers tree, the selection overlay and the marquee from the records plus the `drag` state.
- `CanvasFrame`, `CanvasShape` and `SelectionOverlay` only render the node objects they receive, and report presses through one-value callbacks: `press({ event, id })`, `resize({ event, dir })`.
- `app/lib/geometry.js` is pure math with no framework imports: placement (`placeChildren` for free and stack layouts), hit-testing, bounds and style strings.

## Design rules and gotchas

- **A `{#for}` body is one element or component.** The compiler rejects anything else, so a loop body that is a `{#case}` or an `{#if}` sits in `<div class="contents">` (Editor.pzl, CanvasFrame.pzl). The wrapper adds no box, so the positioned shapes still place against the stage or the frame.
- **Resize grips stop the press.** The overlay root is `pointer-events-none` and only the `.sel-handle` grips turn pointer events back on. Each grip calls `stopPropagation()` on `pointerdown`; without it the press reaches the stage and starts a marquee.
- **Two document `keydown` handlers.** A permanent one runs the shortcuts: Escape clears the selection, Delete or Backspace deletes, ⌘/Ctrl-D duplicates, the arrows nudge. A per-gesture one is added on press and makes Escape cancel the gesture. The permanent one returns at once while `this._drag` is set, or one Escape would cancel the drag and also clear the selection.
- **The layers panel gets its own tree (`layerNodes`).** The canvas tree lifts dragged nodes out into the ghost layer, so a shared tree made layer rows vanish mid-drag.
- **Ghosts take no pointer.** Ghost nodes carry `pointer-events:none`. The drop target comes from the records (`frameAt()` skips the dragged ids), not from the element under the pointer.
- **No store writes during a gesture.** `pointermove` stores raw coordinates on `this._drag` and schedules one `requestAnimationFrame`, which publishes through `setState`. `record.update()` runs only on drop (`_commitMove`, `_commitResize`) or on a keyboard nudge, so Escape mid-gesture writes no records.
- **One teardown.** Document listeners are added on press and removed by a single `_cleanup()`, which drop, Escape and `destroyed()` all call.

## Not built

- Pan and zoom: the stage is a fixed 2400×1600 at 1:1. A screen-to-stage transform belongs in `geometry.js`, applied where `Editor.pzl` turns `clientX`/`clientY` into stage coordinates.
- Nested frames: one level only; a dragged frame never drops into another frame.
- Multiplayer and undo: both need to know where each write came from. `store.observe()` calls back with no arguments, so the store has no change hook with an origin tag.
- Snap guides, inline text editing, and resizing a multi-selection (the grips show only when one element is selected).
