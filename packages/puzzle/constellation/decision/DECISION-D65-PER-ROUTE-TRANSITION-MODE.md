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
---

# D65 — Per-route/per-view transitionMode override, resolved destination-only

## Context

D56 (v1.24) shipped `transitionMode: 'overlap' | 'sequential'` as a single
app-wide Router/PuzzleApp config switch — every navigation in an app plays the
same way. D56 flagged this as a deliberate v1-scope cut, not a ceiling: it
considered and rejected a per-view `animations.mode` override "for round 1"
because a route transition spans **two different view instances** (the
outgoing one, the incoming one — often different classes) with no shared
owner, so letting either side's field control the transition invites "spooky
cross-view action" — whose field wins when they disagree? D56 explicitly left
the door open: "Can be added later without breaking this surface."

A user request to have some routes/views overlap and others stay sequential,
within the same app, prompted revisiting that deferral. Two things make it
tractable now that weren't spelled out at D56 time:

1. **The ambiguity is resolvable, not fundamental.** A transition is not a
   live negotiation between two instances — it can be a lookup keyed to
   exactly one side. If resolution is strictly **directional** (the
   destination decides, always), there is never a case where two declarations
   compete: for A→B only B's config is read; the reverse B→A reads only A's,
   independently. This mirrors two things the framework already does the same
   way: `meta.title` resolves per-destination-route (nearest-defined walking
   the chain, §ROUTER `#setTitle`), and each view's own `animations.in`
   already unilaterally controls its own entrance regardless of what is being
   left.
2. **Layouts are `PuzzleView` subclasses** (confirmed: `DefaultLayout extends
   PuzzleView` in every shipped example). D30's one-animator rule guarantees
   the router's per-transition animator is always exactly one instance — a
   routed view OR a layout, never both, never anything else (nested/reusable
   components like `Button.pzl` are `skipEnter()`'d and never asked). So a
   single "does the incoming animator's own class declare a preference"
   mechanism covers view swaps AND layout swaps with no special-casing.

## Decision

**Three-tier cascade, most specific first, resolved fresh per navigation**
(previously a single boolean captured once at Router construction):

1. **Route-level** — a `transitionMode` field on a route/child-route
   definition in `routes.js`, sibling to `layout`/`meta` (not nested inside
   `meta`, which is reserved for page-metadata like `title`; `transitionMode`
   is structural, like `layout`). Resolved via **nearest-defined walk of the
   DESTINATION chain, leaf → root** — the identical walk `#setTitle` already
   uses for `meta.title` — so a parent route can set it once for every child
   that declares none of its own.
2. **View/layout-level** — an optional `transitionMode` field on the incoming
   animator's class, colocated with `animations`:
   ```js
   export default class GalleryView extends PuzzleView {
     transitionMode = 'overlap';
     animations = { in: {...}, out: {...} };
   }
   ```
3. **App-level** — the existing `transitionMode` constructor option (D56),
   now the FALLBACK once nothing more specific applies, not the sole source.

**Resolution is destination-only.** `#resolveTransitionMode(entry,
newAnimator)` is computed in `#swap`, right after `oldAnimator`, and consults
only `entry` (the route being navigated TO) and `newAnimator` (the incoming
animator — `entry.layout && !reuseLayout && cur ? layout : views[keep]`,
hoisted from where it was previously computed only for morph pairing and now
reused for both). The OUTGOING view/route's own `transitionMode` is never
read. This directly resolves D56's "spooky cross-view action" objection: it
was never a live negotiation to begin with, only a lookup on the side being
entered.

**Validation posture mirrors existing precedent, split by tier:** an unknown
route-level value is a construction-time throw (`validateTransitionMode`,
same posture as the other route-shape throws — bad child path, `layout` on a
non-root node, the constructor's own unknown-`transitionMode` check). An
unknown view/layout-level field value warns once per offending class
(`#warnedBadViewTransitionMode`, a `Set` of class names) and falls through to
the next tier — a single misconfigured view must not crash navigation, unlike
a malformed route table.

**Unaffected by construction:** `playOut()`/`playIn()` stay mode-agnostic
executors (the resolved boolean gates one `if` in `#swap`, same as the old
`#overlap` boolean did); D30's one-animator rule; D61's atomic-commit window
and its timing relative to sequential vs. overlap; D55 morph pairing;
interruption/`#pendingOut` machinery (operates on animator instances, not
mode). An app that sets none of the new surfaces is byte-identical to
v1.24–v1.29.

## Alternatives rejected

- **Per-view field with a merge rule** ("either side opts in", "outgoing view
  wins") — rejected: reintroduces exactly the ambiguity D56 flagged. Directional
  resolution (destination-only) achieves the same per-view expressiveness
  without ever needing a tie-breaker, because there is never a tie.
- **`transitionMode` nested inside `meta`** — rejected: `meta` is established
  as a page-metadata bag (`title`); `transitionMode` governs runtime behavior
  like `layout`, which already sits top-level. Keeping the grouping semantic
  (metadata vs. structural) avoids a `meta` bag that mixes concerns.
- **Generic per-component override** (any `.pzl`, not just the routed
  view/layout) — never seriously on the table: D30 already guarantees only
  the one-animator instance is ever consulted for a route transition: a field
  on `Button.pzl` would simply never be read. Scoping to `PuzzleView`
  subclasses that can actually BE an animator is not a restriction, it is the
  shape of the problem.
- **Route-level value scoped to `entry.chain[keep]`/`entry.chain[0]` only (no
  chain walk)** — rejected in favor of the full leaf→root walk: cheaper to
  reason about (one rule, reused from `#setTitle`) and strictly more useful
  (a parent route can set a default for an entire subtree), with no observed
  downside — D30 already guarantees only one level ever animates per
  transition, so "which ancestor's declaration applies" was never actually
  ambiguous, just unresolved before this walk existed.

## Consequences

- `tests/router-overlap.test.js` gained a `D65` describe block: route-level
  override, view-level override, route-over-view precedence, destination-only
  directionality (A→B vs. B→A), layout-swap resolution off the fresh layout
  class, nearest-defined chain walk past an undefined child to a declaring
  parent, and the invalid-view-field warn-once-and-fall-through path.
- Zero Go compiler changes — `transitionMode` is a runtime route-config/view-field
  concern, not template syntax.
- `#overlap` (boolean) renamed to `#defaultTransitionMode` (string); callers
  outside the Router are unaffected (private field).
