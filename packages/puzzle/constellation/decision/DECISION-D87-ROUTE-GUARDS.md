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
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D87 — Route guards: the inherited `guard` route field

Any route node may declare `guard: ({ to, from, ctx }) => verdict`. A navigation
runs every guard on the matched chain **root → leaf, sequentially, first failure
wins**, before any view or layout is constructed and before the D19 load gate.
Guarding a top-level route locks its whole layout subtree. Spec:
[[DOC-SPEC-ROUTER]] §48, [[DOC-ROUTER]].

## Decision

- **Field:** a top-level route field (sibling of `layout`/`transitionMode`/
  `prerender`, not in `meta`), valid at any depth. Each entry compiles its
  inherited chain at construction; a non-function guard throws there.
- **Phase:** in `#navigate` after the match and token bump, before
  construction — a denied navigation has nothing to tear down and commits
  nothing. Guards re-run on **every** matched navigation, params- and
  query-only included. The token is rechecked after every await. Unguarded
  routes keep a synchronous path (no added microtask).
- **Verdicts are return values:** `undefined`/`true` allow, `false` blocks
  (stay put), a string path redirects. A throw is reported through `onError`
  (D145) and stays put. `push()`/`replace()` resolve the outcome (D182):
  `reason: 'blocked'` for `false`, `'error'` for a throw or the redirect limit,
  `redirectedFrom` on a redirected success.
- **Redirects go through the public seam and inherit the denied navigation's
  verb:** a denied push redirects via `push()` (Back still reaches the origin
  page); a denied pop or navigation #0 via `replace()` (the browser already sits
  on the denied URL). Denied URLs never enter history (push writes nothing until
  commit, D61). The destination's guards run normally.
- **A blocked pop** puts the URL back to the committed route. **A blocked
  navigation #0** (`false`, nothing committed) renders nothing and logs a
  console error: entry guards should redirect, not return `false`.
- **Loop safety:** at most ten guard redirects per logical navigation; the next
  is a cycle (reported, stay put). The count resets on a successful commit and
  at every externally initiated navigation; a redirect re-entering
  `push()`/`replace()` is flagged (`#guardRedirecting`) as a continuation.
- **Output modes warn, never enforce** (Cory's call — guards are UX, not a
  secrecy boundary): hybrid prerender warns per rendered page with a guard in
  its chain (`prerender: false` is the quiet opt-out); static output warns once
  that guards never run.
- **Idioms:** restore sessions in `beforeMount` (D66) so guards stay
  synchronous store reads; redirect-after-login uses the query
  (`'/login?redirect=' + encodeURIComponent(to.path)`, read via D83).
  `examples/stays` is the acceptance flow.

## Gotchas

- **Self-redirect:** a guard that redirects to the path it denies (a parent
  guard bouncing to `/login` where `/login` inherits it) would make `push()`'s
  same-path in-flight join return the denied navigation's own promise and
  deadlock. `push()` skips that join while `#guardRedirecting` is set, so the
  loop hits the limit loudly instead. Pinned in `tests/router.test.js`.

## Alternatives rejected

- **Global `beforeEach` + `meta.requiresAuth` (Vue)** — policy away from the
  route tree, a second registration surface.
- **Root-only `guard`** — forces a tree split when a sub-section needs a second
  check.
- **Throw-based redirects** — exceptions as control flow; the router owning the
  redirect keeps D61 atomicity central.
- **Always redirect via `replace()`** — overwrites the origin entry, so Back
  from `/login` skips the page the user was on.
- **Field name `auth`** — names a use case and implies session machinery that
  doesn't exist.
- **Hard enforcement in prerender modes** — rejected by Cory; warnings keep the
  choice with the developer.
