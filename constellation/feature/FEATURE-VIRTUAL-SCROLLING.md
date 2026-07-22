---
name: Virtual scrolling
status: verified
connections:
  - COMPONENT-VIEW-MANAGER
  - DECISION-D53-NAMED-SLOTS
  - DOC-SPEC
verified_at: '2026-07-14T07:08:23.035Z'
verified_sha: f867f10b5a09efb6fbf650f0d5432cc0edc17332
---

# Virtual scrolling

**Resolved to a documented userland recipe** (2026-07-14) — exactly the
outcome this card told its DECISION pass to prototype for first. The
reference implementation is `examples/virtual-scroll/`: 10,000 rows rendered
as a constant ~27-row DOM window on **stock Puzzle, zero framework changes**.

## The recipe (fixed-height, single list)

- `created()` builds the row array once as a plain instance field; `data()`
  slices `rows.slice(start, start + count + 2*overscan)`.
- `@scroll={ onScroll(event) }` computes `start = floor(scrollTop / ROW_H) −
  overscan`, clamps, and calls `setData('start', …)` + `refresh()` **only
  when the start bucket changed** (no patch storm — sub-row scrolling never
  re-renders).
- Two spacer divs with interpolated inline heights (`style="height:{ topPx
  }px"`) carry off-window geometry so the scrollbar stays honest; keyed
  `{#for}` over the slice reuses row DOM across windows (v1.26 `keyOf`).
- Verified by `tests/virtual-scroll-example.test.js` (4 jsdom tests over the
  compiled view): bounded DOM (27 rows, ~110 elements at any offset), window
  math after scroll, `top + rows·ROW_H + bottom === total` invariant,
  no-patch-storm.

One DX papercut a user hits (SPEC §4 by design): `setData` doesn't re-run
`data()`, so the derived window recomputes only via the explicit `refresh()`
— the example documents it inline.

## Framework feature: deliberately NOT built (for now)

A reusable `<VirtualList items={…}>` is **gated on scoped slots**: with only
default/named slots (v1.21, D53), a child cannot hand each item's data back
to a caller-supplied row template — so a generic component can't exist
without new grammar (scoped slots or a vnode-returning callback prop), and
offers little over the inline recipe. If scoped slots ever land, revisit;
also still out: variable-height auto-measurement (estimate/measure/anchor
machinery — most of the complexity for the minority case) and router scroll
restoration into an inner windowed scroller (D33/D41 target window scroll
only).
