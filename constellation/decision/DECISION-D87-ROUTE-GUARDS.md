---
name: 'D87 — route guards: the inherited `guard` route field (v1.53)'
status: built
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-ROUTER
  - DOC-RELEASE-SURFACE
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D66-APP-LIFECYCLE-HOOKS
  - DECISION-D83-QUERY-REPLACE
  - FILE-ROUTER
  - FEATURE-V1-53-ROUTE-GUARDS
---

# D87 — route guards: the inherited `guard` route field (v1.53)

Client-side navigation middleware. Any route node may declare `guard: fn`
(`({ to, from, ctx }) => verdict`); a navigation runs every guard along the
matched chain **root → leaf, sequentially, first failure wins**, before any
view/layout construction and before the D19 load gate. Guarding a top-level
route locks its whole layout subtree with one declaration — the D30 "layouts
are auth walls" framing made literal. Cory's design (2026-07-23); see
[[DOC-SPEC]] §48 and the [[DOC-ROUTER]] guards section.

## Context

Guards sat on the deliberately-not-shipped list from v1 ("Planned — not in
v1"), with the interim idiom being a `router.push('/login')` from `mounted()` —
which D61/D83 machinery (commit-window deferral, same-path no-op, `replace()`)
was explicitly hardened to support. A cross-framework survey (Vue Router
guards + merged `meta`, ember-simple-auth's authenticated parent route,
TanStack's `_authenticated` layout route, Angular `canActivate`/
`canActivateChild`, React Router middleware) shows subtree-at-the-layout-
boundary is the universal auth idiom, and surfaced the one famous footgun:
SvelteKit's layout-guard pitfall, where guards riding data-loading primitives
that are cached across child navigations (and run parallel to children)
silently fail to protect subtrees. Puzzle's load-then-atomic-commit pipeline
is structurally immune **if** guards get their own sequential, always-run
phase before the load gate — which is exactly where this lands. The
`#navigate` chokepoint (every push/replace/popstate/initial navigation flows
through it) made a single insertion point possible.

## Decision

**One new route field, one new pipeline phase:**

- `guard` is a top-level route field (sibling of `layout`/`transitionMode`/
  `prerender` — behavioral flags stay out of `meta`, which is reserved for
  page metadata) valid at **any depth**, unlike root-only `layout`. The entry
  compiles its inherited chain at construction
  (`chain.map(n => n.guard).filter(Boolean)`); a non-function guard throws at
  construction like an unknown `transitionMode`.
- Guards run in `#navigate` after the match and cancellation-token bump,
  before any view/layout is constructed — a denied navigation has nothing to
  tear down and commits nothing (D19/D61 inherited). They re-run on **every**
  matched navigation (params-only and query-only included — avoiding Vue's
  `beforeEnter`-doesn't-refire surprise), with the token rechecked after every
  await so a superseded guarded navigation abandons silently.
- **Verdicts are return values, not throws:** `undefined`/`true` allow,
  `false` blocks (stay put), a string path redirects — and the ROUTER performs
  the redirect via the public `replace()` seam (denied URLs never enter
  history; the destination's own guards run through the normal pipeline).
  A thrown guard follows the data()-failure posture: log, stay put. The
  shared post-failure cleanup (stalled-transition + pending-memory-index
  recovery) is one helper used by both paths.
- **Loop safety:** at most ten guard redirects without an intervening commit;
  the next is treated as a cycle (console.error, stay put). A real A↔B cycle
  never commits, so the cap catches it; the query-param deny idiom commits on
  `/login` and resets the counter. Redirect-to-committed-path stays the D83
  same-path no-op.
- **Output modes — warnings only, no enforcement** (Cory: the developer's
  call; guards are UX, not a secrecy boundary — prerendered files are public
  bytes and servers must authorize independently). Hybrid prerender warns per
  rendered page whose chain has a guard (`prerender: false` is the quiet
  opt-out); a static build warns once that guards never run (no router).
- **Idioms over API:** session restore belongs in D66 `beforeMount(app)`
  (awaited before navigation #0, so guards stay synchronous store reads);
  redirect-after-login is the query idiom
  (`'/login?redirect=' + encodeURIComponent(to.path)`, read back via the D83
  query snapshot) — no new router state.

## Consequences

- `examples/stays` gains the acceptance flow: a store-backed fake session, a
  guarded `/account` subtree, and a `/login` view that replays
  `this.route.query.redirect` via `replace()`.
- The `mounted()`-redirect idiom remains valid (and its hardening remains
  load-bearing for guards' own redirects), but declarative guards are now the
  documented path — no flash of protected content, no wasted `data()` run.
- Guards are SPA/hybrid-runtime behavior; static output ignores them by
  construction. Public types gain `GuardFn` + `Route.guard`.
- Unguarded routes keep a byte-identical synchronous path to view
  construction (the guard phase adds no microtask when `entry.guards` is
  empty).

## Alternatives rejected

- **Global `beforeEach` hook + `meta.requiresAuth` flags (Vue's shape)** —
  policy lives away from the route tree, needs a matched-chain scan in user
  code, and adds a second registration surface; the route field keeps the
  lock visible exactly where the subtree is declared.
- **Root-only `guard` (strict `layout` parity)** — inheritance already gives
  the layout lock; forbidding child guards forces a route-tree split the
  moment an admin sub-section needs a second check.
- **Throw-based redirects (`throw redirect(...)`, TanStack/React Router
  shape)** — return values compose with the existing verdict handling and
  avoid exception-as-control-flow; the router performing the redirect keeps
  D61 atomicity centralized (Angular's "return a UrlTree, never `navigate()`
  imperatively" rule, same reasoning).
- **`auth` as the field name** — names the dominant use case, not the
  mechanism; misleads for role/paywall/onboarding gates and implies framework
  session machinery that deliberately does not exist. Release surface already
  said "navigation guards."
- **Hard enforcement in prerender modes (auto-exclude or build error)** —
  rejected by Cory: SSG blogs and auth'd SPAs barely overlap in practice, and
  a developer prerendering a guarded route may legitimately mean it (public
  markup, UX-only gate). Warnings keep the footgun visible without taking the
  choice away.
