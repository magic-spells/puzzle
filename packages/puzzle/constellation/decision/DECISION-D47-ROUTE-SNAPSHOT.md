---
name: 'D47 — Per-navigation route snapshot: `this.route` rides the D19 gate'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - DOC-ROUTER
  - DOC-SPEC
code_refs:
  - client-runtime/router/router.js
  - client-runtime/views/PuzzleView.js
---

# D47 — Per-navigation route snapshot: `this.route`

A gating `data()` needs a route source that describes **the navigation it is gating**. Reused ancestors re-run `data()` before the commit ([[DECISION-D19-NAVIGATION-COMMIT]], [[DECISION-D30-NESTED-ROUTES]]), so `router.current` and `location` still show the old route there — an active-tab underline computed from them lags one navigation (and `location.pathname` is wrong in hash mode and meaningless in memory mode).

## Decision
- The router builds one frozen `to = { path, route (leaf node), params, chain }` per navigation, before the load phase, and passes it to every gated `preload({ params, props, route })` / `refresh({ params, route })` — fresh views, reused ancestors, the params-only branch, and a reused layout's post-commit refresh.
- `PuzzleView` stores it and exposes `get route()`. An argless `refresh()` (a store change) keeps the stored snapshot. Off-router it is `null`; non-routed components take route state as props.
- It rides the **same channel as params**, so snapshot and params always describe the same navigation, in every mode, on push, pop and initial load. Per-call state — nothing global to clear on failure. A reused ancestor whose sibling's load rejects keeps its committed params and snapshot ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]).
- A reused layout's branch runs `applyParentUpdate → #commitState → refresh`, so its post-commit `data()` reads a fresh `router.current`.
- **Idiom:** match on route **names** (`this.route.route.name`, `this.route.chain[0].name`), not path strings — immune to query, `#anchor` and mode differences.

## Alternatives rejected
- A reactive `router.current` — a second `data()` run per navigation (double-fetch footgun), new store machinery, and the highlight flips only after the out animation. It could layer on later.
- A global pending target / `router.isActive(path)` reading the in-flight navigation — an unrelated refresh paints the uncommitted target, and a failed navigation leaves it painted. `isActive()` as sugar over `this.route` stays open.
- A reserved `params.$route` — pollutes params and collides with a literal `$route` param.
- Committing `#state` earlier — reused and fresh `data()` must stay pre-commit, and `#state` must keep meaning "the mounted chain" (interruption planning, `stop()`, scroll timing).
- A second post-commit refresh of reused ancestors — double `data()` runs and the old tab shows through the out animation.
