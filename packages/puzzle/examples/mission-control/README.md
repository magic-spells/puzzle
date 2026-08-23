# Mission Control — Puzzle animation showcase

A dark, blue-tinted "ops console" built with the [Puzzle](../../) framework. It
exists to exercise the **animation system** (v1.1 / D28) end-to-end, across every
surface the framework offers:

| Surface | Where | What you see |
| --- | --- | --- |
| **View / route transition** | each view's `animations = { in, out }` | Switching sidebar sections fades the old view out, then the new one in (the sidebar stays put — one animator per transition, D28) |
| **Component enter on mount** | `ListRow` / `StatTile` `get animations()` with `delay: index * N` | List rows and stat tiles **cascade in** when a section loads |
| **Nested-route child swap** (v1.3, D30) | `Detail.pzl`, routed at `/fleet/:id`, `/missions/:id`, `/crew/:id` | Selecting a list item navigates to the `:id` child route and **slides the details panel in from the right** through the section view's `<Slot/>`; closing navigates back and slides it out |

## Run it

```bash
cd examples/mission-control
npm install
npm run dev        # serves on http://localhost:3000
```

`npm run build` produces the production bundle in `dist/`.

## How it's put together

- **Plain data, no store.** All content is plain JS in [`app/data/catalog.js`](app/data/catalog.js)
  in one unified item shape, so a single `ListRow` and `Detail` view serve every
  section. (The `blog` example already showcases the store; this one stays focused
  on motion.)
- **Selection is URL state.** Each section route has `children`: an index child
  (`path: ''`) that renders nothing, and a `path: ':id'` child that renders the
  shared [`Detail.pzl`](app/views/Detail.pzl) view at the section's `<Slot/>`.
  Clicking a row calls `router.push('/fleet/<id>')`; the section view is a
  *reused ancestor* on that swap, so its `data(params)` re-runs with the merged
  params and the row highlight tracks the URL — no local selection state, and
  deep links / back / forward work for free.
- **Only the swapped level animates.** The one-animator rule (D28, generalized
  by D30): on `/fleet ⇄ /fleet/:id` only the detail level swaps, so the panel
  plays its slide while the list stays put. Entering a section from elsewhere
  animates the section view instead, and any panel below it is `skipEnter`'d.
- **The enter's `to` equals resting CSS.** WAAPI releases the enter fill on
  finish, so every `in.to` (e.g. the panel's `translateX(0)`) matches the
  element's natural state to avoid a snap on settle.
- **Active nav is declarative.** `AppShell` reads `window.location.pathname` in
  `data()` (which re-runs after the URL commits on each reused-layout swap) to
  highlight the current section — no DOM class juggling.

### Things to try

- Click between **Overview / Fleet / Missions / Crew** to watch the section
  transition and the staggered list/tile entrance.
- Select a row, then select a **different** row while the panel is open — that
  is a params-only navigation, so the panel instance is reused and the content
  swaps in place with no re-slide (the calm default). Clicking the **active**
  row toggles the panel closed.
- **Deep link** straight to a record (e.g. `/fleet/odyssey-ii`) — the panel is
  already open on load. Then drive the panel with the browser **back / forward**
  buttons; it slides out and back in.
- Turn on **Reduce Motion** at the OS level — the runtime zeroes durations while
  everything still functions.
