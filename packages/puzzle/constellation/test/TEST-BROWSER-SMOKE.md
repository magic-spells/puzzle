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
  - FEATURE-OVERLAPPING-TRANSITIONS
  - DOC-TESTING
---


# Real-browser transition and navigation smoke

A deliberately small Chromium + WebKit suite covering the one thing jsdom cannot
do: real animation timing and real browser history and scroll. It complements
the exhaustive vitest state-machine suites and does not replace them.

What it proves:

- sequential mode keeps only the outgoing view in the DOM mid-transition, and
  the destination alone once settled.
- overlap mode has both views coexisting mid-transition, then the destination
  alone with no leftover fixed positioning.
- rapid interruption lands on the final destination with no orphaned nodes and
  no running animations.
- reduced motion is honored end to end in a real engine.
- browser back and forward return to the correct committed route, with URL and
  rendered view agreeing.
- the router owns window scroll: a forward push lands the new route at the top.

Run with `npm run test:browser`. Playwright starts two dev servers itself, both
via `go run` against the repo compiler — a memory-mode two-app page for the
transition mechanics, and a path-mode multi-route app with tall pages for
history and scroll restoration. The suite is fully serial with a single worker
because the timing assertions are order-sensitive, and the cold-start timeouts
are generous because `go run` recompiles the compiler first.

Covers 2 spec files under `tests-browser/`.
