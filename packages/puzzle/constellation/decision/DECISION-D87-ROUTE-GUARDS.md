---
name: 'D87 — Route guards: the inherited guard route field'
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DOC-ROUTER
  - DOC-RELEASE-SURFACE
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D66-APP-LIFECYCLE-HOOKS
  - DECISION-D83-QUERY-REPLACE
  - FILE-ROUTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D87 — Route guards: the inherited `guard` route field

Any route node may declare `guard: ({ to, from, ctx }) => verdict`. A navigation
runs every guard on the matched chain **root → leaf, sequentially, first failure
wins**, before any view/layout is constructed and before the D19 load gate.
Guarding a top-level route locks its whole layout subtree. Spec:
[[DOC-SPEC-ROUTER]] §48, [[DOC-ROUTER]].

## Decision

- **Field:** top-level route field (sibling of `layout`/`transitionMode`/
  `prerender`, not in `meta`), valid at any depth. Each entry compiles its
  inherited chain at construction; a non-function guard throws at construction.
- **Phase:** in `#navigate` after the match and token bump, before
  construction — a denied navigation has nothing to tear down and commits
  nothing. Guards re-run on **every** matched navigation, params- and
  query-only included. The token is rechecked after every await. Unguarded
  routes keep a synchronous path (no added microtask).
- **Verdicts are return values:** `undefined`/`true` allow, `false` blocks
  (stay put), a string path redirects. A throw logs and stays put (the
  `data()`-failure posture). The router performs redirects through the public
  seam, **inheriting the denied navigation's verb**: a denied push redirects via
  `push()` (Back still reaches the origin page); a denied pop or navigation #0
  redirects via `replace()` (the browser already sits on the denied URL).
  Denied URLs never enter history (push writes nothing until commit, D61). The
  destination's guards run normally.
- **Loop safety:** at most ten guard redirects per logical navigation; the next
  is a cycle (console.error, stay put). The count resets on a successful commit
  and at every externally initiated navigation; a guard redirect re-entering
  `push()`/`replace()` is flagged (`#guardRedirecting`) as a continuation.
- **Self-redirect gotcha:** a guard that redirects to the path it denies (a
  parent guard bouncing to `/login` where `/login` inherits it) would make
  `push()`'s in-flight same-path guard return the denied navigation's own
  promise, deadlocking. `push()` skips that guard while `#guardRedirecting` is
  set, so the loop hits the limit loudly instead. Pinned in
  `tests/router.test.js` with a timeout race.
- **Output modes warn, never enforce** (Cory's call — guards are UX, not a
  secrecy boundary): hybrid prerender warns per rendered page with a guard in
  its chain (`prerender: false` is the quiet opt-out); static output warns once
  that guards never run.
- **Idioms:** restore sessions in `beforeMount` (D66) so guards stay
  synchronous store reads; redirect-after-login uses the query
  (`'/login?redirect=' + encodeURIComponent(to.path)`, read via D83).
  `examples/stays` is the acceptance flow.

## Alternatives

- **Global `beforeEach` + `meta.requiresAuth` (Vue)** — rejected: policy away
  from the route tree, a second registration surface.
- **Root-only `guard`** — rejected: forces a tree split when a sub-section needs
  a second check.
- **Throw-based redirects** — rejected: exceptions as control flow; the router
  owning the redirect keeps D61 atomicity central.
- **Always redirect via `replace()`** — rejected: overwrote the origin entry, so
  Back from `/login` skipped the page the user was on.
- **Field name `auth`** — rejected: names a use case and implies session
  machinery that doesn't exist.
- **Hard enforcement in prerender modes** — rejected by Cory; warnings keep the
  choice with the developer.
