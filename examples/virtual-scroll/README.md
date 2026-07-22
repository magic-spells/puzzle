# Virtual Scroll (userland recipe)

A 10,000-row list that keeps only ~27 rows in the DOM at any time — built on
**stock Puzzle with zero framework changes**. This example is the prototype for
[`constellation/feature/FEATURE-VIRTUAL-SCROLLING.md`](../../constellation/feature/FEATURE-VIRTUAL-SCROLLING.md):
its open question is "framework feature vs userland recipe," and the answer this
demonstrates is **recipe** — the v1 runtime already has everything fixed-height
windowing needs.

## The recipe

Everything lives in [`app/views/Home.pzl`](./app/views/Home.pzl):

1. **A fixed-height scroll container** owns the scrollbar
   (`h-[600px] overflow-y-auto`) and carries a plain `@scroll={ onScroll(event) }`
   listener.
2. **The dataset is built once** in `created()` and held as a plain instance
   field (`this.allRows`) — it never changes, so it stays out of reactive state.
3. **`data()` slices a bounded window** out of that array
   (`allRows.slice(start, start + WINDOW)`), where `start` is the only reactive
   piece of state.
4. **The scroll handler recomputes the window's start bucket** and calls
   `setData('start', …)` + `refresh()` **only when the bucket actually changed** —
   so a fast flick doesn't trigger a render on every scroll pixel.
5. **Two spacer divs** with interpolated inline heights
   (`style="height:{ topPx }px"`) reserve the off-window geometry, so the native
   scrollbar behaves exactly as if all 10,000 rows were present. The invariant
   `topPx + renderedRows·ROW_H + bottomPx === TOTAL·ROW_H` always holds.
6. **A keyed `{#for row in visibleRows}`** renders the window. Rows carry a plain
   `id`, so the framework's automatic keying reuses row DOM nodes across scrolls.

## Run it

```bash
puzzle dev      # dev server + Tailwind pipeline + live reload
puzzle build    # production build → dist/
```

## Verified

`tests/virtual-scroll-example.test.js` mounts the **compiled** view and asserts
the DOM window is bounded (27 row nodes, never 10,000), that a simulated scroll
re-renders the correct new first-visible row, and that the spacer + row heights
always sum to the full list height.
