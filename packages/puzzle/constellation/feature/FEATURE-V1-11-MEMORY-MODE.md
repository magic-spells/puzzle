---
name: "v1.11 — memory routing (memoryRouter()) + go/back/forward API"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D42-MEMORY-MODE
  - FEATURE-V1-6-HASH-ROUTING
  - FEATURE-ROUTER-BASE-PATH
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-APP
  - DOC-ROUTER
  - DOC-SPEC
  - DOC-SPEC-ROUTER
  - DECISION-D159-ROUTER-MODE-FACTORIES
release: RELEASE-V0-1-0
change: feature
---

# v1.11 — memory routing (`memoryRouter()`) + go/back/forward API

The third router mode (`memoryRouter()` from `@magic-spells/puzzle/router-modes` — [[DECISION-D159-ROUTER-MODE-FACTORIES]]): the route lives entirely in router state — `location`, `history`, and `document.title` are never touched. For tests (no jsdom history gymnastics) and embedded/iframe apps. Driven by [[DECISION-D42-MEMORY-MODE]].

## Intent

Complete the enum [[FEATURE-V1-6-HASH-ROUTING]] reserved a slot in. Memory mode makes the framework's own suites and any consumer's component tests simpler, and gives embeds a mode that cannot clobber the host page's URL or tab title.

## Scope

**In:**
- An in-memory entry stack (`push()` truncates forward entries and appends); the full D19/D28/D30 pipeline unchanged; the stack index moves only at commit, so failed/superseded navigations move nothing.
- `router.go(n)` / `back()` / `forward()` in **all** modes — history/hash delegate to `history.go(n)`; memory moves the stack index and runs the pipeline as a pop; out-of-range `n` is a silent no-op.
- No popstate listener, no `document.title` writes, scroll management a no-op (`scrollBehavior` accepted but inert); the click interceptor stays active (embed caveat documented in [[DOC-SPEC-ROUTER]] §15).
- `memoryRouter({ initialPath })` (Router option `initialPath`, default `'/'`) — rides the mode object, so it structurally cannot be set in the other modes ([[DECISION-D159-ROUTER-MODE-FACTORIES]]).

**Out (deferred to [[FEATURE-ROUTER-BASE-PATH]]):** base-path support; mount-scoped link interception.

## Outcome

Shipped in v1.11; documented in [[DOC-SPEC]] §15/§9/§2 and [[DOC-ROUTER]]. Touched [[COMPONENT-ROUTER]] and the [[COMPONENT-PUZZLE-APP]] config passthrough, plus `tests/router-memory.test.js`; no compiler or runtime-kernel change.
