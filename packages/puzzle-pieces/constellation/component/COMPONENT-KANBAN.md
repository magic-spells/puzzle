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
---

# Kanban

Controlled horizontal board with pointer and keyboard card movement. Columns, drop placeholders, accessible announcements, move intent, and every drag/keyboard handler remain board-owned.

The `card` snippet replaces only a card surface's inner content and receives the raw `card` plus its raw `column`; the existing title, badge, metadata, and assignee body remains the fallback. A single marker declaration in the card loop stamps every item. During pointer dragging the same keyed item becomes the fixed preview instead of rendering a second card, so custom content remains identical without a second marker declaration or unsupported named-snippet forwarding through `KanbanCard`.

The `column-header` snippet replaces the header's inner content and receives the raw `column` plus the visible `count`; the existing title and count badge remain the fallback. Column sections and header containers stay piece-owned.
