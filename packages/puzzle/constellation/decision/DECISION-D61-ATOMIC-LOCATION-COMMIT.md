---
name: D61 — URL/history/title commit atomically with the incoming mount
status: verified
verified_at: '2026-11-01T19:23:12.785Z'
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
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D61 — URL/history/title commit atomically with the incoming mount

Location side effects (pushState/replaceState, memory stack, title, scroll-key save) land in the same synchronous block as the mount and `#state`, so a superseded or failed navigation never leaves a phantom history entry or a URL that disagrees with the view. Extends the D19 data gate.

## Decision

- All location side effects live in `#commitLocation(next)`, called inside `#swap`'s synchronous `#committing` window right before mount/patch and `#commitState`.
- **Sequential (default):** out animation and morph-leave finish → final token checks → commit. A navigation superseded or failed during the out phase touches no location state.
- **Overlap (D56):** the leaver is pinned and its out starts without await, then the same synchronous commit.
- **Params-only:** gated refreshes + token check → `#commitLocation` right before `#commitState`.
- **Pop:** the browser already moved the URL; `#commitLocation` adds only the title (and the memory-mode index). A failed pop can leave the URL ahead of the view — no rollback.
- **Initial navigation:** never pushes; the title is still set at commit.
- **Scroll:** `#navigate` *measures* `{scrollX, scrollY}` at navigation start; `#commitLocation` *persists* it.
- A synchronous push/replace/go from inside the commit window (e.g. from `mounted()`) is deferred through the single last-wins `#pendingPush` slot.

## Alternatives rejected

- **Early commit + history rollback on supersession/failure** — `replaceState`/`go(-1)` compensation races real back/forward, is visible to popstate listeners, and doubles the state machine.
- **Early commit, accept the holes (Vue's approach)** — Vue's window is a microtask; Puzzle's sequential mode holds it open for the whole out animation.

## Gotchas

- In sequential mode the URL/title update one out-animation late; external history listeners (analytics) fire at swap time.
- Reading scroll at swap time is wrong in real browsers: the outgoing view is gone and `scrollY` has clamped to 0. jsdom cannot see this; the Playwright suite guards it.
- A skeleton bypasses its own data gate, but a sequential navigation's location commit still waits for the outgoing leave.
- A throw after `#commitLocation` (mount failure) can leave the URL ahead of the view; recovery is D115's job, not a history rollback.
