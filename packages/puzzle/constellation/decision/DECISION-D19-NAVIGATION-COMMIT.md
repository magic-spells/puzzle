---
name: "D19 — Navigation semantics: commit-ordered URL, nav tokens, catch-all 404, layout reuse"
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
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
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D19 — Navigation semantics: data-gated commit, nav tokens, catch-all 404, layout reuse

See [[DOC-VIEW-LIFECYCLE]] §4.

## Decision
- **The URL commits only after the destination's `data()` resolves.** Every location side effect (pushState, title, memory stack, scroll-key save) runs in `#swap`'s synchronous commit window, after the out phase and the final token checks, immediately before mount ([[DECISION-D61-ATOMIC-LOCATION-COMMIT]]). A failed or superseded navigation changes nothing: no history entry, no URL/view divergence.
- **Last navigation wins** via monotonic tokens.
- **A `data()` rejection stays put.** It reports through the `onError` funnel ([[DECISION-D145-ERROR-BOUNDARIES]]), the current view stays, and `push()` resolves a failed result ([[DECISION-D182-NAVIGATION-RESULT]]). Only navigation zero rethrows, so `app.mount()` rejects.
- **404s go to an optional catch-all `path: '*'` route**, always matched last.
- **Consecutive routes sharing a layout class reuse the layout instance** (its `data()` re-runs, the outlet content swaps via patch); a different layout class remounts.

Nested chains gate on every level ([[DECISION-D30-NESTED-ROUTES]], transactional per [[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]); a fresh view with a `<puzzle-skeleton>` commits immediately ([[DECISION-D39-SKELETON]]).

## Alternatives rejected
- Pushing the URL before the view's data loads — URL and view desync when the load fails or is superseded.
