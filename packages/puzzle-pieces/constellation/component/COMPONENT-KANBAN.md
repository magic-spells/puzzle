---
name: Kanban
status: verified
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
      The keyboard cross-column move keeps its `this.refresh()` on purpose and sets the
      `_refocusGrabbed` marker after it. refresh() runs afterUpdate() synchronously and
      afterUpdate() consumes the marker; a marker set first, or a setState() render alone, is eaten
      before the parent's re-render and focus falls to <body>.
  - kind: state
    text: >-
      Keyboard Escape on a held card drops it where it is, like Space/Enter, and announces "Dropped
      …": each arrow press already emitted a committed @move, so there is nothing to revert. A
      pointer drag still cancels on Escape with no @move. KanbanCard is content-only: a `display:
      contents` root and one `card` prop. The card surface, ghost chrome and drag handlers live in
      Kanban.pzl.
  - kind: state
    text: >-
      KanbanCard's assignee initials disc is `hsl(hue 45% 32%)`, the same formula as Avatar and
      ChatMessage. L32 is the highest lightness at S45 where white initials pass WCAG AA on every
      hue. Keep the three copies in step.
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# Kanban

Controlled horizontal board with pointer and keyboard card movement. Columns, drop placeholders, accessible announcements, move intent, and every drag/keyboard handler remain board-owned.

The `card` snippet replaces only a card surface's inner content and receives the raw `card` plus its raw `column`; the existing title, badge, metadata, and assignee body remains the fallback. A single marker declaration in the card loop stamps every item. During pointer dragging the same keyed item becomes the fixed preview instead of rendering a second card, so custom content remains identical without a second marker declaration or unsupported named-snippet forwarding through `KanbanCard`.

The `column-header` snippet replaces the header's inner content and receives the raw `column` plus the visible `count`; the existing title and count badge remain the fallback. Column sections and header containers stay piece-owned.
