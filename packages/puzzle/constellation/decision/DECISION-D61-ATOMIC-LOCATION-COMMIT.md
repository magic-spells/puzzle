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
notes:
  - kind: deviation
    text: >-
      v1.32 amendment to this decision's scroll clause: "the outgoing scroll position is saved at
      swap time, not click time" is now split into MEASURE vs PERSIST. In real browsers the
      swap-time READ was too late — the outgoing view is destroyed before #commitLocation runs, the
      collapsed page clamps window.scrollY to 0, and every saved position was {0,0} (back-nav
      restored to top; jsdom does no layout so the vitest suite couldn't see it — caught by the
      v1.32 Playwright suite, now a regression guard). Current behavior: #navigate CAPTURES
      {scrollX, scrollY} synchronously at navigation start (the pre-D61 measurement point) and
      #commitLocation PERSISTS that captured value — so the decision's actual goal (a
      superseded/failed nav commits nothing, including scroll) still holds; only the measurement
      moved back to click time.
---

# D61 — URL/history/title commit atomically with the incoming mount

## Context

D19 committed location side effects (pushState, document.title, memory-stack
mutation, scroll-key save) SYNCHRONOUSLY the instant the gated loads resolved —
before `#swap` awaited the outgoing unit's sequential out animation. That left
a vulnerable window the length of the out animation (~200–300ms typical) with
two unfixable-in-place holes (both on the known-deferred list since the round-1
pass, confirmed by Codex's round-2 review):

1. **Phantom history entry**: navigation A commits pushState, then navigation B
   supersedes A during A's out phase (post-playOut token check → `#abandon`).
   A's history entry exists for a route that never rendered; back walks
   through it.
2. **URL/view divergence**: same, but B's gated data() then REJECTS. B never
   commits, the old view is restored — under A's URL. URL and screen disagree
   until the next successful navigation.

The only alternative fix — history rollback (`replaceState`/`go(-1)`) after the
fact — is racy and observable (rejected below).

## Decision

Move ALL location side effects out of `#navigate`'s post-gate commit block into
a new private `#commitLocation(next)` helper, called INSIDE `#swap`'s existing
synchronous `#committing` window, immediately before mount/patch +
`#commitState`. One synchronous block now commits: URL + memory stack + title +
scroll-key save + mount + `#state`. Specifically:

- **Sequential (default)**: out animation + morph-leave complete → final token
  checks pass → `#committing = true` → `#commitLocation` → mount/patch →
  `#commitState`. A navigation superseded or failed during the out phase never
  touches location. This is the fix for both holes.
- **Overlap (D56)**: leaver pinned + out started WITHOUT await → same
  synchronous fall-through to commit + mount. Byte-equivalent timing to before
  (there was no await between commit and mount in overlap anyway).
- **Params-only navigations**: gated refreshes + token check →
  `#commitLocation` immediately before `#commitState`. No animation involved;
  timing effectively unchanged.
- **Pop navigations**: the browser already moved the URL (popstate) —
  `#commitLocation` contributes only title (+ memory-mode index). A FAILED pop
  may still leave the browser URL ahead of the rendered view; no rollback
  (unchanged, documented).
- **Initial navigation**: no pushState ever (unchanged); title still set at
  commit.
- The D19 DATA gate is untouched: a failed load still never commits anything,
  reused ancestors still gate, skeleton views still bypass their own data gate.

## Alternatives

- **Keep early commit + history rollback on supersession/failure** — rejected:
  `replaceState`/`go(-1)` compensation is racy against real user back/forward,
  observable to popstate listeners, and doubles the state machine.
- **Keep early commit (Vue parity), accept the holes** — rejected: Vue's window
  is one microtask (it doesn't await leave transitions before swapping);
  Puzzle's sequential mode holds the window open for the whole out animation,
  so the holes are actually reachable in practice. Pre-npm-publish is the
  cheapest moment to fix observable ordering.
- **Commit after the out but outside the #committing window** — rejected: a
  synchronous reentrant push from mounted() must still defer (#pendingPush);
  location and #state must not be separable by a hook.

## Consequences

- URL/title/history now update one out-animation LATER in sequential mode
  (zero difference for apps without `out` animations; overlap/params-only/pop
  effectively unchanged). URL always matches rendered content.
- The v1.8 skeleton promise narrows in wording: a skeleton still bypasses its
  own DATA gate, but a sequential navigation's location commit still waits for
  the outgoing leave. (SPEC §16 wording updated.)
- The outgoing entry's scroll position is now SAVED at swap time, not
  click time — a user who scrolls during the out animation gets the later
  position remembered (arguably more correct).
- Anything external keying off history/URL changes (analytics snippets) fires
  at swap time.
- Render/lifecycle exceptions AFTER `#commitLocation` (mount throw) can still
  leave URL ahead of view — same class as before, explicitly out of scope
  (no rollback).
- D19's "URL commits the instant loads resolve" language is superseded by
  "URL commits atomically with the incoming mount"; router.js header comments,
  DOC-SPEC §12/§16/§26, DOC-ROUTER, DOC-VIEW-LIFECYCLE, DOC-APP-ANATOMY, and
  CLAUDE.md lifecycle diagrams updated.
