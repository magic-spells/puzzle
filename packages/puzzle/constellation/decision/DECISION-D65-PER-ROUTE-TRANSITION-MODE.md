---
name: D65 — Per-route/per-view transitionMode, resolved destination-only
status: verified
verified_at: '2026-11-01T19:23:12.785Z'
connections:
  - DECISION-D56-OVERLAP-TRANSITIONS
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D28-ANIMATIONS
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
code_refs:
  - client-runtime/router/router.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D65 — Per-route/per-view `transitionMode`, resolved destination-only

`transitionMode: 'overlap' | 'sequential'` (D56) can be set per route, per view and per app. A route transition spans two view instances, so the rule that avoids ties is: only the destination is consulted.

## Decision

Resolved per navigation by `#resolveTransitionMode(entry, newAnimator)` in `#swap`, most specific first:

1. **Route** — a top-level `transitionMode` on a route definition (sibling of `layout`, not inside `meta`), found by a nearest-defined walk of the destination chain leaf → root, so a parent sets it for its subtree.
2. **View/layout** — a `transitionMode` class field on the incoming animator (the routed view or layout D30's one-animator rule picks), beside `animations`.
3. **App** — the PuzzleApp/Router `transitionMode` option (default `'sequential'`).

- The outgoing view/route is never consulted: A→B reads only B, B→A reads only A.
- An unknown route-level value throws at Router construction (`validateTransitionMode`). An unknown view-level value warns once per class in dev and falls through — one bad view must not crash navigation.
- `playOut()`/`playIn()` stay mode-agnostic; D61's commit window and D55 morph pairing are unaffected.

## Alternatives rejected

- **Per-view field with a merge rule** (either side opts in / outgoing wins) — reintroduces the tie.
- **`transitionMode` inside `meta`** — `meta` is page metadata; `transitionMode` is structural like `layout`.

## Gotchas

- A field on a nested component (e.g. `Button.pzl`) is never read — only the one animator is consulted.
- Tests: the `D65` block in `tests/router-overlap.test.js`.
