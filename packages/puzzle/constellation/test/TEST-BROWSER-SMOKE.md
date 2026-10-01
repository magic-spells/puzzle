---
name: Real-browser transition and navigation smoke
kind: e2e
status: built
framework: playwright
connections:
  - COMPONENT-ROUTER
  - COMPONENT-ANIMATIONS
  - FLOW-NAVIGATION
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D28-ANIMATIONS
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D56-OVERLAP-TRANSITIONS
  - DECISION-D65-PER-ROUTE-TRANSITION-MODE
  - DOC-TESTING
---

# Real-browser transition and navigation smoke

A deliberately small Chromium + WebKit suite for what jsdom cannot do: real
animation timing, real history, real scroll. It complements the vitest
state-machine suites; it does not replace them. Specs live in `tests-browser/`
(`transitions`, `navigation`, `anchor-fragment`).

What it proves:

- sequential mode keeps only the outgoing view in the DOM mid-transition, then
  the destination alone; overlap mode has both coexisting, then the destination
  alone with no leftover fixed positioning.
- rapid interruption lands on the final destination with no orphaned nodes and
  no running animations; reduced motion is honored end to end.
- back/forward return to the committed route with URL and view agreeing; a
  forward push lands at the top.
- a bare `<a href="#faq">` click fires popstate then hashchange with null entry
  state; the router does not commit, scroll, focus or announce for it, still
  stamps a scroll key on the browser-created entry, restores scroll across the
  `/#fragment` pair without navigating, and a real route change from a fragment
  URL still commits.

Run with `npm run test:browser`. Playwright starts its own dev servers via
`go run` against the repo compiler (a memory-mode two-app page for transitions, a
path-mode multi-route app with tall pages for history and scroll). The suite is
serial with one worker because the timing assertions are order-sensitive, and
cold-start timeouts are generous because `go run` recompiles the compiler first.
