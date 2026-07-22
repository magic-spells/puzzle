---
name: Puzzle Orrery (examples/orrery) — canvas × datastore animation demo
kind: reference-app
status: verified
verified_at: '2026-07-22T00:04:05.804Z'
connections:
  - DOC-STAYS-EXAMPLE
  - DOC-BLOG-EXAMPLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - COMPONENT-VIEW-MANAGER
  - FILE-EXAMPLES-ORRERY-APP-APP
  - FILE-EXAMPLES-ORRERY-APP-MODELS-BODY
  - FILE-EXAMPLES-ORRERY-APP-VIEWS-HOME
  - FILE-EXAMPLES-ORRERY-APP-COMPONENTS-ORRERYCANVAS
  - FILE-EXAMPLES-ORRERY-APP-COMPONENTS-BODYROW
  - FILE-EXAMPLES-ORRERY-README
notes:
  - kind: verified
    text: >-
      Verified. Evidence: `go run ./compiler/cmd/puzzle build examples/orrery --mode
      development` green (app.js 93.6 KB / 25.0 KB gzip, styles.css, index.html); node --check on
      all 7 plain .js files; live Playwright walkthrough against the served dist in Chromium —
      canvas DPR-sized imperatively (726×518), scene paints (sun + rings + 5 seeded planets incl.
      one retrograde), frames change over 400ms (animating), clicking empty canvas space created a
      6th body record and the panel gained its row (store→DOM and canvas→store both live), Pause
      froze successive frames exactly, zero app console errors (only the sandbox-blocked Google
      Fonts fetch, same as kanban).
---

# Puzzle Orrery (examples/orrery)

A build-your-own solar system: the reactive datastore drives a `<canvas>`
animation through a `requestAnimationFrame` loop. The first canvas usage in
the repo — this is the reference for "how do I tie the store to imperative,
per-frame rendering without fighting the framework." Single route, dark
deep-space Tailwind v4 theme (kanban's shell adapted). Full file inventory in
`examples/orrery/README.md` (trust it over this card for file-level detail).

## The pattern it exists to teach

- **The store is the scene graph.** Each planet is a `body` record holding
  only parameters (`distance`, `size`, `speed` deg/sec — negative =
  retrograde, `phase`, `color`, `name`). Positions are NEVER stored; they are
  a pure function of parameters + elapsed time. No 60fps store writes, ever.
- **rAF is the clock.** `OrreryCanvas` starts the loop in `mounted()`,
  cancels in `destroyed()`; pause freezes the elapsed-seconds accumulator but
  keeps painting, so edits made while paused still show.
- **`data()` is the reactive bridge.** The canvas component's
  `findMany('body')` auto-subscribes it; any createRecord/update/destroy
  re-runs `data()` and the loop's per-frame `getData()` read picks the change
  up mid-animation — a slider drag retimes an orbit live with zero wiring.
- **The canvas writes back.** Click hit-test (positions memoised per painted
  frame) → `select` callback prop up to Home; click empty space →
  `createRecord` with phase derived from click angle minus `elapsed*speed` so
  the planet spawns exactly under the cursor. Same store, two projections:
  canvas pixels + DOM panel rows.

## Framework facts it depends on (gotchas for future edits)

- The `<canvas>` template node declares NO `width`/`height` attrs — sizing is
  imperative (devicePixelRatio-scaled in `mounted()`/ResizeObserver). Safe
  because `patchAttrs` only diffs template-declared attrs, so imperative ones
  survive re-renders — but ONLY while the template never declares them.
- The vdom reuses the canvas element across re-renders (same tag/position,
  no key churn), so the 2d context and backing store persist.
- `prefers-reduced-motion` → Home seeds `running: false` in `created()`; a
  static frame still paints.
- Local UI state (`selectedId`/`running`/`trails`) lives in Home and is read
  back from `getData()` inside `data()` (the kanban Board pattern) so it
  survives store-driven re-runs.
