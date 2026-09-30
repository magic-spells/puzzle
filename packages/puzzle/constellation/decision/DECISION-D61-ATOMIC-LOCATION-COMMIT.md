---
name: D61 — URL/history/title commit atomically with the incoming mount (D19 refinement)
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D28-ANIMATIONS
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D39-SKELETON
  - DECISION-D56-OVERLAP-TRANSITIONS
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
code_refs:
  - client-runtime/router/router.js
  - client-runtime/router/modes.js
---

# D61 — URL/history/title commit atomically with the incoming mount

## Context

Committing location (pushState, title, memory stack, scroll-key save) as soon
as the gated loads resolved left a window the length of the out animation in
which a superseding or failing navigation could leave a phantom history entry
or a URL that disagrees with the rendered view.

## Decision

All location side effects live in `#commitLocation(next)`, called inside
`#swap`'s synchronous `#committing` window immediately before mount/patch and
`#commitState`. One synchronous block commits URL + memory stack + title/head
(D84) + scroll-key save + mount + `#state`.

- **Sequential (default):** out animation and morph-leave finish → final token
  checks → commit. A navigation superseded or failed during the out phase
  touches no location state.
- **Overlap (D56):** leaver pinned, out started without await, then the same
  synchronous commit.
- **Params-only:** gated refreshes + token check → `#commitLocation` right
  before `#commitState`.
- **Pop:** the browser already moved the URL; `#commitLocation` contributes only
  title/head (+ memory-mode index). A failed pop can leave the browser URL ahead
  of the view; there is no rollback.
- **Initial navigation:** never pushes; title still set at commit.
- The D19 data gate is unchanged.
- **Scroll:** `#navigate` *measures* `{scrollX, scrollY}` synchronously at
  navigation start (the outgoing view still has its full height);
  `#commitLocation` *persists* that value. Reading at swap time is wrong in real
  browsers: the outgoing view is already gone and `scrollY` has clamped to 0
  (jsdom cannot see this; the Playwright suite guards it).
- A synchronous push/replace/go from inside the commit window (e.g. from
  `mounted()`) is deferred through the single last-wins `#pendingPush` slot.

## Alternatives

- **Early commit + history rollback on supersession/failure** — rejected:
  `replaceState`/`go(-1)` compensation races real back/forward, is observable
  to popstate listeners, and doubles the state machine.
- **Early commit, accept the holes (Vue parity)** — rejected: Vue's window is a
  microtask; Puzzle's sequential mode holds it open for the whole out animation.

## Consequences

- In sequential mode the URL/title update one out-animation later; URL always
  matches rendered content. External history listeners (analytics) fire at
  swap time.
- A skeleton bypasses its own data gate, but a sequential navigation's location
  commit still waits for the outgoing leave.
- A throw after `#commitLocation` (mount failure) can leave the URL ahead of the
  view; recovery is D115's job, not a history rollback.
