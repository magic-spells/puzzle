---
name: D65 — Per-route/per-view transitionMode override, resolved destination-only (amends D56)
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
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
---

# D65 — Per-route/per-view transitionMode, resolved destination-only

## Context

`transitionMode: 'overlap' | 'sequential'` (D56) started as one app-wide
switch. A per-view override looked ambiguous because a route transition spans
two view instances — whose declaration wins when they disagree?

## Decision

Resolve per navigation, **destination only**, most specific first
(`#resolveTransitionMode(entry, newAnimator)` in `#swap`):

1. **Route** — a top-level `transitionMode` on a route definition (sibling of
   `layout`, not inside `meta`), found by a nearest-defined walk of the
   destination chain leaf → root (the same walk as `meta.title`), so a parent
   sets it for its subtree.
2. **View/layout** — a `transitionMode` class field on the incoming animator
   (the routed view or layout that D30's one-animator rule picks), beside
   `animations`.
3. **App** — the Router/PuzzleApp `transitionMode` option (default
   `'sequential'`) as fallback.

The outgoing view/route is never consulted, so A→B reads only B and B→A reads
only A — there is never a tie.

Validation: an unknown route-level value throws at Router construction
(`validateTransitionMode`, like other route-shape errors). An unknown view-level
value warns once per class and falls through to the next tier — one bad view
must not crash navigation.

`playOut()`/`playIn()` stay mode-agnostic; D61's commit window, D55 morph
pairing and interruption handling are unaffected.

## Alternatives

- **Per-view field with a merge rule** (either side opts in / outgoing wins) —
  rejected: reintroduces the tie destination-only resolution avoids.
- **`transitionMode` inside `meta`** — rejected: `meta` is page metadata;
  `transitionMode` is structural like `layout`.

## Consequences

- A field on a nested component (e.g. `Button.pzl`) is never read — only the
  one animator is consulted.
- Covered by the `D65` block in `tests/router-overlap.test.js` (precedence,
  directionality, layout swap, chain walk, warn-and-fall-through).
