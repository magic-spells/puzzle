---
name: Real-browser transition and navigation smoke
kind: e2e
status: verified
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
  - COMPONENT-DEV-SERVER
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Real-browser transition and navigation smoke

A deliberately small Chromium + WebKit Playwright suite for what jsdom cannot do: real
animation timing, real history, real scroll, real connection limits. It complements the
vitest suites; it does not replace them. Specs in `tests-browser/`. Run with
`npm run test:browser`.

- `transitions`: sequential mode keeps only the outgoing view mid-transition, then the
  destination alone; overlap mode has both coexisting, then the destination alone with no
  leftover fixed positioning. Rapid interruption lands on the final destination with no
  orphaned nodes or running animations; reduced motion is honored end to end.
- `navigation`: back/forward return to the committed route with URL and view agreeing; a
  forward push lands at the top.
- `anchor-fragment`: a bare `<a href="#faq">` click fires popstate then hashchange with
  null entry state; the router does not commit, scroll, focus or announce, still stamps a
  scroll key on the browser-created entry, restores scroll across the `/#fragment` pair,
  and a real route change from a fragment URL still commits.
- `dev-reload`: `puzzle dev` live reload across eight tabs on one origin. One tab (Web
  Locks) holds the only SSE stream and relays over a BroadcastChannel; without that, about
  six tabs exhaust the browser's per-host connection limit and later requests hang.

Harness: `playwright.config.js` starts two dev servers with `go run` against the repo
compiler: `examples/transitions-demo` on :4173 (memory mode, two apps side by side) and
`examples/stays` on :4174 (path mode, tall pages for history and scroll). `dev-reload`
starts its own server on :4175 over a temp app it edits, so the shared servers stay
untouched. One worker, fully serial (timing assertions are order-sensitive); timeouts are
generous because `go run` recompiles the compiler on cold start.
