---
name: "D47 — Per-navigation route snapshot: `this.route` through the D19 gate (v1.15)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - FEATURE-V1-15-ROUTE-SNAPSHOT
  - DOC-ROUTER
  - DOC-SPEC
---

# D47 — Per-navigation route snapshot: `this.route` through the D19 gate (v1.15)

The router builds one frozen `{ path, route, params, chain }` snapshot per navigation (the shape of `router.current`) and threads it through every gated `preload()`/`refresh()`; `PuzzleView` stores it and exposes `get route()`. A gating `data()` finally has a route source that describes **the navigation it is gating**. Plus one reorder: a reused root layout's post-commit refresh now runs after `#commitState`.

## Context

The Stays account tabs (Profile/Trips/Wishlist — nested routes under a reused `AccountShell`) computed the active underline from `window.location.pathname` in `data()`. Per [[DECISION-D19-NAVIGATION-COMMIT]]/[[DECISION-D30-NESTED-ROUTES]], a reused ancestor's `data()` re-runs as the **pre-commit gate** — before `pushState` and before `#commitState` advances `router.current`. So the shell's only `data()` run of the navigation saw the OLD route (via both `location` and `router.current`) and never re-rendered post-commit: the underline lagged one navigation behind, "fixed" by a second click. Deeper gap: **no** route source was correct inside the gate, so the active-nav pattern — table stakes for any nav UI — could not be built at all (`location.pathname` is additionally wrong in hash mode and meaningless in memory mode). Same latent bug in the chirp/music/mission-control examples.

## Decision

- One frozen `to = { path, route (leaf node), params, chain }` per navigation, built **before** the load phase, passed to every gated `preload({params, props, route})` / `refresh({params, route})` (fresh views AND reused ancestors), the params-only branch, and the reused layout's post-commit `#refreshLogged`.
- `PuzzleView` gains `#route` + `get route()`; the snapshot is stored only when a call passes one, so a store-change `refresh()` (argless) retains it. `null` off-router — non-routed components take route state as props.
- It rides the **same channel as params**: snapshot and params always describe the same navigation, in all modes, on push/pop/initial alike. Per-call state — no global "pending route", nothing to clear on failure.
- **Reorder:** `#swap`'s reuseLayout branch now runs `applyParentUpdate → #commitState → #refreshLogged` (matching the params-only branch), so a layout's post-commit `data()` reads a fresh `router.current`. Safe: the DOM was patched by `applyParentUpdate`, so `#commitState`'s mount-first invariant (D33 scroll) holds.
- Matching idiom: route **names** (`this.route.route.name`, `chain[0].name`), not path string-compares — immune to query/`#anchor` (D41)/mode differences.

## Alternatives rejected

- **Reactive `router.current`** (reading it in `data()` subscribes via a store `trackKey`/`notifyKey` seam; commit notifies). The generalizing fix — route obeys the same law as records — but costs a second `data()` run per navigation for route-readers (double-fetch footgun for async `data()`), new public store machinery, a sync flush inside the commit path, and the highlight flips only after the out-animation instead of at click. May layer on later as its own decision; `this.route` doesn't preclude it.
- **Global pending-target / `router.isActive(path)` consulting an in-flight nav.** Global mutable pending state: an unrelated store-change refresh during a pending nav reads the uncommitted target and paints it — and a failed nav leaves it painted with no correction mechanism (a *persistent* version of this very bug). Needs clearing at every failure/supersede/stop exit. `isActive()` as pure sugar over `this.route` stays open — deferred until real demand.
- **Reserved key merged into `params`** (`params.$route`). Pollutes the params contract (§9: params = your `:segment` captures — they get spread, iterated, compared) and collides with a literal `$route` param name.
- **Reorders only** (commit `#state` earlier / next to `pushState`). Cannot fix the gate: reused-ancestor and fresh-view `data()` MUST stay pre-commit (D19). And `#state` must keep meaning "the mounted on-screen chain" — interruption planning (`keep` computed from `cur = #state`), `stop()` teardown, and D33 scroll timing all depend on it; an early commit lets a second navigation "reuse" never-mounted instances (the corpse-adoption bug class the D30 clamp exists for). Only the small reuseLayout reorder survives, as a complement.
- **Post-commit second refresh of reused ancestors.** Double `data()` runs (fetches, flicker) and the old tab would still show through the whole out-animation.

## Consequences

- Additive: `data(params, props)` unchanged; views that never read `this.route` behave byte-identically.
- Failure semantics inherited, not widened: a reused ancestor whose sibling's load rejects has already re-rendered with the target's params *and* snapshot — the pre-existing, documented D19/D30 soft-violation, with `route` now riding alongside `params`.
- The examples' `location.pathname` active-nav idiom is retired everywhere (it was the bug); DOC-ROUTER now prescribes `this.route` + route names.
