---
name: "D56 — Overlapping route transitions: opt-in transitionMode with fixed-pin positioning (amends D28)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D28-ANIMATIONS
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D55-MORPH-TRANSITIONS
  - FEATURE-OVERLAPPING-TRANSITIONS
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
notes:
  - kind: state
    text: >-
      Amended by [[DECISION-D65-PER-ROUTE-TRANSITION-MODE]] (v1.30). The per-view
      `animations.mode` override rejected below "for round 1" (spooky cross-view action — whose
      field wins when the outgoing and incoming views disagree?) shipped as a three-tier cascade
      (route field → view/layout class field → this card's app-level default), resolved
      DESTINATION-ONLY: only the incoming side's config is ever consulted, so there is never a
      tie to break. This card's own contract — app-level opt-in as the baseline, fixed-pin
      positioning, D19/D61 commit timing, D30 one-animator rule — is otherwise unchanged.
---

# D56 — Overlapping route transitions: opt-in `transitionMode` with fixed-pin positioning (amends D28)

Settled (v1.24). Route transitions gain an opt-in **overlap mode**: the old
view's `out` animation and the new view's `in` animation run concurrently
(cross-fade, shared-axis slides). Sequential stays the default — a config
surface without `transitionMode` behaves byte-identically to v1.23.

## Context

D28 made view transitions deliberately sequential (old `out` → destroy →
mount → new `in`) because overlap needs a **positioning strategy**: both
views must occupy the same space at once, and D28's no-wrapper principle
(animations play on the instance's own root; the framework injects no
elements) rules out the wrapper-container approach other frameworks use.
Meanwhile the ViewManager independently shipped overlapping COMPONENT-level
leaves (v1.1: a leaving component with `animations.out` stays in place via
`destroyAnimated()` + the `leavingEls` move-guard while siblings patch around
it) — so the runtime already knows how to keep a dying element alive while
new content arrives; only the route level lacked it.

## Decision

- **Opt-in, app-level.** `transitionMode: 'overlap'` in the PuzzleApp config
  (default `'sequential'`), passed through to the Router like
  `scrollBehavior`/`routerMode`. One knob for the whole app — navigation feel
  is an app-level property. A per-view `animations.mode` override was
  REJECTED for round 1 (D8 minimalism; and it would let one view's field
  change how a DIFFERENT view's out plays — spooky cross-view action). Can be
  added later without breaking this surface.
- **Fixed-pin positioning — the wrapper-free strategy.** At the out-phase
  start the router measures the outgoing animator root's
  `getBoundingClientRect()` and pins it with INLINE styles only:
  `position: fixed` at the measured rect (top/left/width/height),
  `margin: 0`, `pointer-events: none`. `fixed` positions against the
  viewport, so no injected wrapper or positioned ancestor is needed — D28's
  no-wrapper rule holds. The incoming chain takes over the layout slot in the
  same synchronous block, so in-flow content never stacks or jumps. The
  pinned element, being positioned, paints above in-flow content by default —
  right for fade-out-over-new; `pointer-events: none` keeps mid-fade clicks
  landing on the live view.
- **Reordered #swap, convergent destroy.** In overlap mode `#swap` pins the
  leaver, starts `playOut()` WITHOUT awaiting, and proceeds straight to
  mount/patch + commit (D19's commit point is unchanged — data was already
  awaited pre-swap; the commit just no longer waits for the out). The leaver
  is destroyed when its out settles. On the reused-layout path the keyed
  patch's own `unmount()` → `destroyAnimated()` drives the same memoised
  `playOut()`; `destroy()` is idempotent, so the router's completion handler
  and the patch path converge on one teardown. Morph-leave (D55) keeps its
  contract: a returned promise is still awaited before the leaver's removal.
- **Interruption stays instant.** `#pendingOut` keeps its invariant (at most
  one in-flight leaver): a navigation arriving mid-overlap destroys the
  still-fading leaver synchronously and skips its own out phase — the same
  posture sequential mode has today, so at most two route elements ever
  coexist.
- **Hook semantics in the overlap window.** `viewWillHide()` fires at
  out-start, then the new view's `mounted()`/`viewWillShow()` fire while the
  old view is still fading; `viewDidHide()` fires when the out settles and
  `viewDidShow()` when the in settles — their relative order is UNSPECIFIED
  (whichever animation ends first). Sequential mode's ordering is untouched.
- **Unchanged:** initial navigation (no leaver), params-only navigations
  (never reach the out/in machinery), memory mode semantics, reduced-motion
  (zeroed durations make overlap effectively instant), failure recovery (the
  out still starts only after preload succeeds, so doomed navigations never
  pin).

## Consequences

- **Documented constraints:** (1) `position: fixed` mis-pins when an ancestor
  of the mount container has `transform`/`filter`/`contain` (containing-block
  trap) — apps must keep the container chain transform-free, same spirit as
  D55's morph constraints. (2) Document height snaps to the new view at
  commit; a cross-fade hides this well, wildly different page lengths less
  so. (3) The leaver stops scrolling with the page for its fade (fixed);
  irrelevant at 200–300ms durations. (4) Combining with a registered morph
  handler is best-effort — the morph pairing scan may find the pinned dying
  element as a counterpart; recommended to pick one mechanism per app.
- Rejected alternatives: the **View Transitions API** (snapshot-based — no
  live interaction mid-transition, Safari support too recent, and it can't
  express the shipped `animations` field's WAAPI semantics; baseline stays
  WAAPI parity); **absolute-position + injected wrapper** (violates D28);
  **overlap as the new default** (a behavior change to every shipped app for
  no opt-in cost).
