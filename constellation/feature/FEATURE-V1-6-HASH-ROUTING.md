---
name: "v1.6 — Hash routing"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D34-HASH-ROUTING
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
---

# v1.6 — Hash routing

An opt-in `routerMode: 'hash'` carries the route in `location.hash` (`/#/user/123`) for static hosts with no rewrite rules; app code stays path-shaped. Driven by [[DECISION-D34-HASH-ROUTING]].

## Intent
Through v1.5 the router only routed off `location.pathname`, forcing every host to serve `index.html` for every app route (the history-API fallback). On a static host that can't be configured — GitHub Pages, an S3 bucket, `file://` — that fallback doesn't exist, so a deep link or reload 404s.

## Scope
**In:** `routerMode: 'hash'` touching exactly three seams in the one router file — reading the current URL (fragment vs pathname+search), writing on push (`pushState('#' + path)`, keeping the D33 scroll key in `history.state`), and the link interceptor. The API stays path-shaped: routes, `push('/user/123')`, `current.path`, and params are identical in both modes — no `#` in app code. popstate-only (no `hashchange` listener); non-route fragments (no leading `/`) are ignored, not normalized; default stays `'history'`; unknown values throw at construction.
**Out (rejected):** a Vue-Router-style pluggable history-abstraction layer (over-engineering for two modes), hash-shaped app APIs, a second `hashchange` listener (double-fires), normalizing bare fragments, and a boolean `hashRouting`/nested `router: { mode }` config shape. Sub-decisions in [[DECISION-D34-HASH-ROUTING]].

## Outcome
Shipped in v1.6; documented in [[DOC-SPEC]] §15 and [[DOC-ROUTER]]. `routerMode` is the second amendment to the frozen §2 config surface (after v1.5's `scrollBehavior`). Router-only: D19 commit, D28 transitions, D30 nested chains, and D33 scroll all apply unchanged; an omitted `routerMode` is exact v1.5 behavior. Touched [[COMPONENT-ROUTER]].
