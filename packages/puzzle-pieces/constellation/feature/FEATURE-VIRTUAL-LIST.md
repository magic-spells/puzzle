---
name: Virtual list piece
status: building
change: feature
connections:
  - DOC-REGISTRY
  - DOC-DEMO-DOCS-SITE
  - DECISION-CONFIG-FIRST-API
---

# Virtual list piece

Large fixed-height collections need bounded DOM work without moving item ownership or row markup into the registry. The copy-in virtual list owns only vertical windowing and stamps caller-owned row content through Puzzle snippets.

## Scope

- A presentational + behavioral `virtual-list` piece accepts an `items` array, required positive `rowHeight`, numeric `height` / `maxHeight`, default-five `overscan`, an optional stable `itemKey` field, and caller `class`.
- Top and bottom spacers preserve native scrollbar geometry while only the visible slice plus overscan renders; every row wrapper is keyed.
- One named row position stamps `item` and absolute `index`, with `{ item }` as its no-snippet fallback.
- The scroll region is a named `role="list"`; mounted `role="listitem"` rows expose their position in the virtual set.
- Registry metadata, the downstream demo copy, live snippet-driven docs, generated navigation/route entries, and counts follow [[DOC-REGISTRY]] and [[DOC-DEMO-DOCS-SITE]].
- Out: dynamic or measured row heights, horizontal virtualization, data fetching, selection, and keyboard navigation inside caller row content.

## Acceptance

- Mounted rows stay bounded by viewport rows plus overscan while spacers and row wrappers preserve the full fixed-height geometry.
- Scrolling changes the render window only when the row bucket changes.
- The row snippet receives the correct item and absolute index; omitting it renders the item value.
- The worktree Puzzle 0.7.0 compiler builds the registry component and live demo.
- Registry/package tests and the demo production build pass.
