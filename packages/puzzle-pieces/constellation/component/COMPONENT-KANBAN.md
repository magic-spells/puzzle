---
name: Kanban
status: built
framework: puzzle
props:
  - name: columns
    type: array
    required: true
  - name: disabled
    type: boolean
slots:
  - name: card
    accepts:
      - card
      - column
  - name: column-header
    accepts:
      - column
      - count
code_refs:
  - registry/ui/kanban/Kanban.pzl
  - registry/ui/kanban/KanbanCard.pzl
  - registry/ui/kanban/piece.json
connections:
  - DOC-REGISTRY
  - DECISION-CONFIG-FIRST-API
notes:
  - kind: gotcha
    text: >-
      The `_refocusGrabbed` marker for a keyboard cross-column move must be set AFTER the
      announcement setData/refresh(), not before: refresh() runs afterUpdate() synchronously, and
      afterUpdate() consumes and clears the marker — so a marker set first was eaten by the
      announcement render and focus fell to <body> on the parent's real re-render. Fixed 2026-09-04
      (Astra review F6) by moving the assignment to just before `_emitMove()`.
---

# Kanban

Controlled horizontal board with pointer and keyboard card movement. Columns, drop placeholders, accessible announcements, move intent, and every drag/keyboard handler remain board-owned.

The `card` snippet replaces only a card surface's inner content and receives the raw `card` plus its raw `column`; the existing title, badge, metadata, and assignee body remains the fallback. A single marker declaration in the card loop stamps every item. During pointer dragging the same keyed item becomes the fixed preview instead of rendering a second card, so custom content remains identical without a second marker declaration or unsupported named-snippet forwarding through `KanbanCard`.

The `column-header` snippet replaces the header's inner content and receives the raw `column` plus the visible `count`; the existing title and count badge remain the fallback. Column sections and header containers stay piece-owned.
