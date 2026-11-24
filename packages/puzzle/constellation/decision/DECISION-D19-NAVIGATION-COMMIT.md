---
name: "D19 — Navigation semantics: commit-ordered URL, nav tokens, catch-all 404, layout reuse"
status: verified
verified_at: '2026-11-24T18:05:31.213Z'
connections:
  - COMPONENT-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DOC-ROUTER
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
code_refs:
  - client-runtime/router/router.js
  - client-runtime/router/modes.js
  - client-runtime/router/routePath.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/ssg/index.js
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# D19 — Navigation semantics: data-gated commit, nav tokens, catch-all 404, layout reuse

See [[DOC-VIEW-LIFECYCLE]] §4.

## Decision

- **With a page on screen, the URL commits only after the destination's `data()` resolves.** Every location side effect (pushState, title, memory stack, a push's scroll-position save) runs in `#commitLocation`, the first step of the synchronous commit window: in `#swap` after the out phase and the final token checks, immediately before mount, or right before `#commitState` on a params-only navigation ([[DECISION-D61-ATOMIC-LOCATION-COMMIT]]). A failed or superseded navigation changes nothing: no history entry, no URL/view divergence. A path or hash pop is the one case where the browser moves the URL first: when neither the pop nor a navigation that superseded it lands, the router rewrites the popped entry back to the committed path. With nothing committed yet a failed load commits (below).
- **Last navigation wins** via monotonic tokens.
- **A `data()` rejection with a page on screen stays put.** It reports through the `onError` funnel ([[DECISION-D145-ERROR-BOUNDARIES]]), the current view stays, and `push()` resolves a failed result ([[DECISION-D182-NAVIGATION-RESULT]]). With nothing committed yet (a first load, or a navigation that starts before anything has committed) there is no current view: the top unit (the layout, else the root view) commits, the app `errorView` takes its place, and the navigation resolves `ok`; a hybrid takeover keeps its prerendered page instead. `app.mount()` resolves either way; only a commit-window throw on navigation zero rethrows.
- **404s go to an optional catch-all `path: '*'` route**, always matched last.
- **Consecutive routes sharing a layout class reuse the layout instance** (its `data()` re-runs, the outlet content swaps via patch); a different layout class remounts.

Nested chains gate on every level ([[DECISION-D30-NESTED-ROUTES]], transactional per [[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]); a fresh view with a `<puzzle-skeleton>` commits immediately ([[DECISION-D39-SKELETON]]).

## Alternatives rejected

- Pushing the URL before the view's data loads — URL and view desync when the load fails or is superseded.
- Staying put on a `data()` rejection with nothing committed yet — the container stays empty, the blank hole [[DECISION-D145-ERROR-BOUNDARIES]] exists to remove.
- Rethrowing a first-load `data()` rejection from `app.mount()` — the page stays blank with no retry, and the app is torn down for a failure the error view already has a face for.
