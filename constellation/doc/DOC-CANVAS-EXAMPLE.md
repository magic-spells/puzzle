---
name: Puzzle Studio (examples/canvas) — mini-Figma canvas editor demo
kind: reference-app
status: verified
connections:
  - DOC-ORRERY-EXAMPLE
  - DOC-CHAT-EXAMPLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - COMPONENT-VIEW-MANAGER
  - FILE-EXAMPLES-CANVAS-APP-VIEWS-EDITOR
  - FILE-EXAMPLES-CANVAS-APP-LIB-GEOMETRY
  - FILE-EXAMPLES-CANVAS-APP-MODELS-ELEMENT
  - FILE-EXAMPLES-CANVAS-APP-COMPONENTS-INSPECTOR
  - FILE-EXAMPLES-CANVAS-APP-COMPONENTS-CANVASFRAME
  - FILE-EXAMPLES-CANVAS-APP-COMPONENTS-SELECTIONOVERLAY
  - FILE-EXAMPLES-CANVAS-README
  - FILE-EXAMPLES-CANVAS-PLAN
verified_at: '2026-07-22T00:04:04.941Z'
notes:
  - kind: verified
    text: >-
      Verified at 9c143f7 (Phase 2+3 commit). Evidence: dev + prod builds green (prod 78.5 KB raw /
      22.9 KB gzip incl. app); 260 vitest + all Go package suites pass; independent Playwright pass
      against the served production bundle in Chromium — drag-move commits exact deltas (Panel
      540,360 → 620,410 after +80/+50 drag), SE-handle resize exact (220×140 → 260×170 after
      +40/+30), Escape mid-drag leaves position untouched, stack reorder swaps Title/Subtitle order
      in the Profile card, marquee selects 2 free elements, zero page errors (only sandbox font
      fetch + favicon 404 console noise, same as kanban/orrery).
---

# Puzzle Studio (examples/canvas)

A mini-Figma canvas editor: drag rect/ellipse/text elements and one-level
frames around a 2400×1600 stage, select (click / shift / marquee), resize
via 8 grips, reparent by dropping into/out of frames, reorder inside
stack-layout frames, and edit options (fill, opacity, radius, shadow
presets, text, frame layout/gap/padding, z-order) in a live inspector.
The repo's **direct-manipulation stress test** — a full pointer-gesture
state machine layered over pure store-driven rendering. File inventory and
"try this" walkthrough in `examples/canvas/README.md`; shipped-vs-deferred
scope (pan/zoom, nested frames, multiplayer) in `examples/canvas/PLAN.md`;
the original feasibility/multiplayer analysis in
`notes/canvas-studio-plan.md`.

## The pattern it exists to teach

- **The store is the document; gestures are ephemeral.** Committed geometry
  and style live in `element` records; a pointer gesture (move / resize /
  marquee / stack-reorder) publishes live state via `setData()` + ONE
  requestAnimationFrame per frame, and only the drop calls
  `record.update()`. Escape cancels with zero writes. This generalizes the
  kanban Board's PENDING→DRAGGING machine to four gesture modes.
- **`data()` is pure derivation.** Render tree (frames with
  `placeChildren`-placed children), ghost layer, drop-target flag, overlay
  bounds, marquee box — all derived from records + ephemeral state each
  re-render. Stack-layout child positions are never stored; they are a pure
  function of siblings + gap + padding (the orrery rule applied to layout).
- **One interaction owner.** All pointer/keyboard state is in Editor.pzl;
  CanvasFrame/CanvasShape/SelectionOverlay are dumb projections; geometry
  math is framework-free in `app/lib/geometry.js`.
- **Single-payload callback props.** Children invoke
  `this.props.press({ event, id })` / `resize({ event, dir })` — the first
  argument binds to `event` in the parent's template expression.

## Framework facts it depends on (gotchas for future edits)

- **`{#for}` body needs a single element/component root** — `{#case}`
  dispatch inside loops is wrapped in `<div class="contents">`
  (display:contents creates no box, so absolute positioning still resolves
  against the stage/frame).
- **Template text nodes do not decode HTML entities** (`&amp;` renders
  literally — write `&`).
- **Dragged "ghost" nodes carry `pointer-events:none` in their css** so the
  data-driven drop-target hit-test (`frameAt`) is never occluded; the
  selection overlay root is pointer-events-none with only the resize grips
  re-enabled, and grips `stopPropagation()` so a grip press doesn't start a
  marquee via the stage's pointerdown.
- **Two document keydown handlers coexist** (permanent editor keys +
  per-gesture Escape); the permanent one early-returns while `this._drag`
  is set.
- **The layers panel consumes a separate drag-stable tree** (`layerNodes`)
  because the canvas tree lifts dragged elements into the ghost layer
  mid-drag.
- No framework changes were needed — everything is shipped v1.x surface
  (D18 listeners, D28 animations, D29 loop counter, D37 case, D38
  modifiers).
