---
name: "D33 — Router-owned window scroll: top on push, per-entry restore on back/forward (v1.5)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-ROUTER
  - DOC-ROUTER
  - DOC-SPEC
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D28-ANIMATIONS
  - DECISION-D32-CLI-TOOLING
---

# D33 — Router-owned window scroll: top on push, per-entry restore on back/forward (v1.5)

The router takes ownership of window scroll: top on push, saved-position restore on back/forward (keyed per history entry), fall-back to top otherwise; the landing is applied inside the D19 commit. On by default, opt-out via `scrollBehavior`. Settled (v1.5); see [[DOC-SPEC]] §14 and [[DOC-ROUTER]].

## Context
Through v1.4 the router never touched scroll, so every window-scrolling app inherited the browser's default: navigating to a new route left the window wherever the old one was scrolled (a fresh page opening halfway down), and back/forward restoration was the browser's `'auto'` behavior, which fires *before* the router has swapped views and so restores against the wrong content. D33 makes the router **own window scroll**: push → top, back/forward → the position the target entry was at when it was left (in-memory, keyed by a `__puzzleScrollKey` stamped into `history.state`), fall back to top when none is saved. The initial navigation and any failed/superseded navigation leave scroll alone. The landing is applied **inside the [[DECISION-D19-NAVIGATION-COMMIT]] commit** — synchronously after the incoming view mounts, before paint, after the old view's `out` animation — so it never flashes the old offset or jumps mid-transition. Additive like D28–D32: router-only, no compiler or runtime-kernel change; flat and nested routing are otherwise unchanged.

## Decision
Sub-decisions, each with its rejected alternative:

- **The router owns scroll; apps do not hand-roll it.** The `examples/stays` app shipped exactly the app-level workaround; D33 deletes it. (Rejected: leaving scroll to app code — see Alternatives rejected.)
- **Scroll lands after mount, inside commit — not at `pushState` time.** Resolving the target at commit and applying it in `#commitState` — after the new view is in the DOM, before paint — scrolls the content the user is actually about to see. This extends the D19 commit contract with a scroll-apply point; the commit stays atomic (URL + title synchronous, scroll applied as the new content lands). (Rejected: applying the scroll when the URL changes — see Alternatives rejected.)
- **Positions are in-memory, not persisted across reloads.** In-memory restoration matches Vue Router's accepted default (reload resets to top), and it keeps v1.5 dependency-free and free of storage-quota/serialization edge cases. The browser's own restoration is switched to `'manual'` between `start()`/`stop()` (previous value restored) precisely so it does not fight the router; a reload therefore lands at top, which is the accepted trade. (Rejected: persisting the position map in `sessionStorage` — see Alternatives rejected.)
- **Scroll management is on by default, opt-out — not opt-in.** Scroll-to-top on navigation is universal, browser-expected behavior. Apps that genuinely should not window-scroll (a shell that scrolls an inner panel — the `examples/music` `overflow-hidden` layout) opt out with `scrollBehavior: false`; a `(to, from, savedPosition) => {x,y}|null` function customizes per navigation (falsy return leaves scroll alone; a throw is logged and treated as falsy, never breaking the nav). (Rejected: defaulting to "router does nothing unless configured" — see Alternatives rejected.)

## Alternatives rejected
- **Leaving scroll to app code** (the status quo): a trap. The only app-level lever is a layout that resets scroll in `data()`, and that **only works while the layout has no store subscriptions** — the moment the layout's `data()` re-runs for an unrelated store change it would re-scroll to top mid-session (`examples/stays` shipped exactly this workaround). And restoration on back/forward is **impossible to build correctly at the app level at all** — it requires saving the *outgoing* entry's scroll position at the instant the user leaves it, which only the router's popstate/commit hooks observe (by the time an app-level handler runs, the browser has already moved the history entry).
- **Applying the scroll at `pushState` time** (when the URL changes): the old view is still on screen during its `out` animation ([[DOC-SPEC]] §12 / [[DECISION-D28-ANIMATIONS]]), so a scroll-to-top would visibly jump *the outgoing content* before it animates away.
- **Persisting the position map in `sessionStorage`** so scroll survives a full reload: deferred — in-memory matches Vue Router's accepted default and keeps v1.5 dependency-free and free of storage-quota/serialization edge cases.
- **Defaulting to "router does nothing unless configured" (opt-in):** a framework that *doesn't* scroll-to-top by default produces surprising blank-looking pages and bug reports.

## Consequences
`scrollBehavior` is the **first amendment to the frozen [[DOC-SPEC]] §2 config surface** (every prior amendment [[DECISION-D28-ANIMATIONS]]–[[DECISION-D32-CLI-TOOLING]] extended grammar, animations, routing, or the CLI — none touched the app config object). The change is router-only: no compiler impact, no runtime-kernel change. The D19 commit contract gains the scroll-apply point inside `#commitState`.

Non-breaking: apps that never scrolled the window are unaffected, and `scrollBehavior: false` restores the pre-v1.5 hands-off behavior exactly; this is an additive amendment (v1.5).
