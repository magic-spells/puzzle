---
name: 'D33 — Router-owned window scroll: top on push, per-entry restore on back/forward'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D28-ANIMATIONS
  - DECISION-D41-SCROLL-ANCHORS-PERSISTENCE
code_refs:
  - client-runtime/router/router.js
  - client-runtime/app.js
---

# D33 — Router-owned window scroll: top on push, per-entry restore on back/forward

See [[DOC-SPEC-ROUTER]] §14 and [[DOC-ROUTER]]. Anchors and reload persistence: [[DECISION-D41-SCROLL-ANCHORS-PERSISTENCE]].

## Decision
- **The router owns window scroll, on by default.** Push → top. Back/forward → the position the target entry had when it was left, keyed by a `__puzzleScrollKey` stamped into `history.state`; top when none is saved. The initial navigation and any failed or superseded navigation leave scroll alone.
- **Scroll lands inside the commit**, in `#commitState` — after the new view mounts, before paint, after the old view's `out` ([[DECISION-D19-NAVIGATION-COMMIT]]) — so it never jumps the outgoing content or flashes the old offset.
- The browser's own restoration is set to `'manual'` between `start()` and `stop()` (previous value restored) so it does not fight the router.
- **Opt out** with `scrollBehavior: false` (an app that scrolls an inner panel). A `(to, from, savedPosition) => {x,y} | null` function customizes each navigation; a falsy return leaves scroll alone, and a throw is logged and treated as falsy.

## Alternatives rejected
- Leaving scroll to app code — a layout that resets scroll in `data()` re-scrolls on every unrelated store change, and back/forward restore is impossible at app level (only the router sees the outgoing entry at the instant it is left).
- Scrolling at `pushState` time — the old view is still on screen during its `out` ([[DECISION-D28-ANIMATIONS]]).
- Opt-in scroll management — a fresh page opening halfway down is the surprising default.
