---
name: "v1.5 — Router scroll behavior"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D33-ROUTER-SCROLL
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
---

# v1.5 — Router scroll behavior

The router takes ownership of window scroll across navigations — top on push, saved-position restore on back/forward — with a `scrollBehavior` config to opt out or customize. Driven by [[DECISION-D33-ROUTER-SCROLL]].

## Intent
Through v1.4 the router never touched scroll, so every window-scrolling app inherited the browser default: a new route opened wherever the old one was scrolled, and back/forward restoration fired before views swapped (restoring against the wrong content). Correct back/forward restoration is impossible to build at the app level — only the router's popstate/commit hooks observe the outgoing entry's position at the instant the user leaves it.

## Scope
**In:** push → scroll top; back/forward → the position the target entry held when left (in-memory, keyed by `__puzzleScrollKey` in `history.state`), falling back to top; initial and failed/superseded navigations leave scroll alone; the landing applied inside the D19 commit (synchronously after mount, before paint, after the old view's `out`); on-by-default with `scrollBehavior: false` opt-out and a `(to, from, savedPosition) => {x,y}|null` customizer (falsy leaves scroll alone; a throw is logged and treated as falsy). Browser restoration switched to `'manual'` between `start()`/`stop()`.
**Out (deferred):** persisting positions across full reloads via `sessionStorage` (deferred — matches Vue Router's reload-resets-to-top default, keeps v1.5 dependency-free). Sub-decisions and the app-level workaround it deletes (`examples/stays`) are in [[DECISION-D33-ROUTER-SCROLL]].

## Outcome
Shipped in v1.5; documented in [[DOC-SPEC]] §14 and [[DOC-ROUTER]]. `scrollBehavior` is the first amendment to the frozen §2 config surface. Router-only: no compiler or runtime-kernel change; apps that never scrolled the window are unaffected and `scrollBehavior: false` restores exact pre-v1.5 behavior. Touched [[COMPONENT-ROUTER]].
