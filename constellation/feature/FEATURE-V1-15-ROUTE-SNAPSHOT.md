---
name: "v1.15 — this.route: per-navigation route snapshot in data()"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - DOC-ROUTER
  - DOC-SPEC
---

# v1.15 — `this.route`: per-navigation route snapshot in `data()`

Routed views and layouts read `this.route` — `{ path, route, params, chain }`, the shape of `router.current`, but describing **the navigation this `data()` run is gating**. The only route source that is correct inside the pre-commit D19 gate, and in all three router modes. Driven by [[DECISION-D47-ROUTE-SNAPSHOT]].

## Intent

Make the active-nav highlight buildable. A reused ancestor's `data()` (nested routes, [[DECISION-D30-NESTED-ROUTES]]) runs before `pushState`/`#commitState`, so `location.pathname` and `router.current` are both one navigation stale there — the Stays account tabs bug (underline lagged one click behind). `this.route` rides the same delivery channel as `params`, so snapshot and params always agree.

## Scope

**In:**
- Router: one frozen `to` snapshot per navigation, built pre-load-phase, threaded through every gated `preload()`/`refresh()`, the params-only branch, and the reused layout's post-commit refresh (`#refreshLogged` grew a `route` arg).
- `PuzzleView`: `#route` field + `get route()`; stored only when passed, so store-change (argless) refreshes retain it; `null` for non-router-mounted components.
- Reorder: reuseLayout branch commits state **before** the chrome refresh — a layout's post-commit `data()` now reads a fresh `router.current`.
- Examples swept to the route-name idiom (`this.route.route.name` / `chain[0].name`): stays AccountShell + MainLayout, chirp ProfileShell + MainLayout, music AppLayout, mission-control AppShell.
- Tests across `router-nested` / `router` / `router-hash` / `router-memory` / `view` suites (gate sees the target while `current`/`location` are old; failed/superseded navs leak nothing; argless refresh retains).

**Out (deferred):** reactive `router.current` (subscription on read — its own decision if demand appears); `router.isActive(path)` matcher sugar over `this.route`.

## Outcome

Shipped in v1.15; documented in [[DOC-SPEC]] §19 (+ §9 cross-ref) and [[DOC-ROUTER]]. Touched [[COMPONENT-ROUTER]] and [[COMPONENT-PUZZLE-VIEW]] only — no compiler, store, or ViewManager change; snapshot-free apps patch byte-identically.
