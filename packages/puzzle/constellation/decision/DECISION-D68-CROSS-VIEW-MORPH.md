---
name: 'D68 — Cross-view morphs: capture-at-leave flights in enableMorph'
status: verified
connections:
  - DECISION-D55-MORPH-TRANSITIONS
  - DECISION-D28-ANIMATIONS
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - COMPONENT-MORPH
  - COMPONENT-ROUTER
  - DOC-SPEC
verified_at: '2026-07-17T07:52:47.299Z'
code_refs:
  - client-runtime/morph.js
---

# D68 — Cross-view morphs: capture-at-leave flights in `enableMorph`

Elements sharing a `data-puzzle-morph` value morph across sibling view swaps
(a card's art flies into the detail header, and back on pop) with no app code
beyond `enableMorph(app)`. Default-on, both directions.

## Context

D55 pairs only elements that coexist in the DOM (nested-route dialogs).
Sequential transitions destroy the outgoing view before the incoming mounts, so
sibling swaps have no pairing moment. The router's `leave(el)` hook fires at
out-phase start while the outgoing subtree is still connected and unfaded — a
capture point userland never had.

## Decision

All of it lives in `client-runtime/morph.js`; the router's single morph slot
(D55) is unchanged.

- **Capture at leave.** `leave(el)` snapshots every measurable morph element in
  the leaving subtree as `Map<id, {el, rect}>`. Detached refs stay cloneable
  after destroy, so pops and programmatic navigations morph too.
- **Click pin (polish only).** A delegated capture-phase document click
  listener records the clicked element (guarded for Node prerender). If fresh
  (<5s) and inside the leaving subtree, `leave()` pins a fixed-position clone
  over it pre-fade (morph attrs stripped, `z-index:55`, no pointer events, 2s
  TTL) so it holds still while the old view animates out.
- **Fly at enter.** `enter(el)` scans all morph elements in the entering
  subtree: a live counterpart outside the subtree wins (D55 pair + fly-back);
  otherwise the matching capture gets a clone flight (the pinned clone, or one
  built pre-paint from the snapshot rect). Clone flights always drop the clone
  on settle and call `engine.stop()` only when `show()` settled true (a false
  settle means a newer flight owns the engine). They never set `pair` — the
  reverse trip comes from the next leave's capture.
- **Skeleton-deferred targets.** If captures exist but the entering subtree has
  no morph element yet, a MutationObserver on the animator waits (2s TTL) for a
  measurable match.
- **Cleanup.** Captures are per navigation: replaced at the next leave,
  consumed or dropped at enter. A superseded navigation (enter never fires) is
  cleaned by TTLs and the next leave. `prefers-reduced-motion` disables capture;
  `options.attribute` flows through every selector (`CSS.escape`).

## Alternatives

- **Keep it userland** (clone-on-click recipe) — rejected: ~110 subtle lines
  per app, and click capture can't do pops or programmatic navigation.
- **A second/richer router hook** — rejected: the existing slot already fires
  while the subtree is measurable (D55's one-slot posture).
- **Pin clones for every captured element** — rejected: a 50-card grid would
  float 50 clones over the out animation; only the clicked one is pinned.

## Consequences

- The capture-flight target's view should use an opacity-only `in` animation
  (or none): the engine measures the target rect once at flight start, so a
  transform entrance makes the element pop away from where the blob lands.
  Documented, not enforced.
- One flight per transition, one shared engine; live pairs beat captures for
  the same id.
- Tests: `tests/morph-cross-view.test.js`.
