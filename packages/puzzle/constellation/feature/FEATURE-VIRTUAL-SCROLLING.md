---
name: Virtual scrolling
status: verified
connections:
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC-TEMPLATE
  - DOC-SPEC-ROUTER
verified_at: '2026-11-01T19:19:25.478Z'
change: chore
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Virtual scrolling

No framework feature: stock Puzzle renders a bounded window of a long list.
`examples/virtual-scroll/` is the reference (10,000 rows, ~27 row nodes in the
DOM), and `tests/virtual-scroll-example.test.js` pins it. The reusable form is
the `VirtualList` piece in `packages/puzzle-pieces/registry/ui/virtual-list`,
which hands each row back to the caller through a snippet
([[DOC-SPEC-TEMPLATE]] §64).

## The recipe (fixed row height, window scroll inside one scroller)

- Build the row array once in `created()` as a plain instance field; `data()`
  returns `rows.slice(start, start + window)` with overscan on both sides.
- The `@scroll` handler computes the start bucket from `scrollTop / ROW_H`,
  clamps it, and calls `setData` + `refresh()` **only when the bucket changes** —
  sub-row scrolling never re-renders.
- Two spacer divs with interpolated inline heights carry the off-window
  geometry, so `top + rows·ROW_H + bottom === total` and the scrollbar stays
  honest. A keyed `{#for}` reuses row DOM across windows.

Gotcha: `setData` does not re-run `data()`, so the derived window only
recomputes through the explicit `refresh()`.

Not covered: variable-height auto-measurement, and router scroll restoration
into an inner scroller (the router restores window scroll only,
[[DOC-SPEC-ROUTER]] §14).
