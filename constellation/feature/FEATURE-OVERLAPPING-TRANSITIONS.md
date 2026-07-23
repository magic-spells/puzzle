---
name: Cross-fade / overlapping route transitions
status: verified
verified_at: '2026-07-23T16:30:52.114Z'
connections:
  - DECISION-D56-OVERLAP-TRANSITIONS
  - DECISION-D28-ANIMATIONS
  - FEATURE-V1-1-ANIMATIONS
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - DOC-VIEW-LIFECYCLE
  - DOC-SPEC
  - FILE-ROUTER
  - FILE-PUZZLE-APP
  - FILE-TESTS-ROUTER-OVERLAP-TEST
notes:
  - kind: verified
    text: >-
      Verified: tests/router-overlap.test.js (8 — pin styles + coexistence, hook
      ordering, sequential-default guard, mid-overlap interruption with exactly-once destroys,
      reused-layout patch-driven teardown, instant-out, config validation) + tests/app.test.js
      passthrough case; full suite 532 vitest + all Go packages green. Review pass by
      the orchestrator added the settle-handler .catch (a throwing viewWillHide/viewDidHide would
      otherwise strand the pinned leaver + surface an unhandled rejection) and the PuzzleApp
      transitionMode conditional passthrough.
  - kind: verified
    text: >-
      v1.32: overlap semantics unchanged by the hardening pass (the router diffs —
      #observeMount, #runPendingPush finally, #pendingIndex, departure-scroll capture — are all
      orthogonal to the pin/concurrent-play machinery). Now exercised in REAL browsers: the
      Playwright suite asserts outgoing+incoming coexist mid-transition and no inline position:fixed
      pin survives settle, on Chromium AND WebKit. Documented as EXPERIMENTAL for 0.1.0 in README
      (interaction-matrix caution: overlap×morph, overlap×nested-reused-layout).
verified_sha: 93ebefacfc0dcd35ea787a1f09b56aa308bea4f9
---

# v1.24 — Overlapping route transitions

Shipped via [[DECISION-D56-OVERLAP-TRANSITIONS]]. Set
`transitionMode: 'overlap'` globally, per route, or on the destination view
class to run outgoing `out` and incoming `in` animations concurrently.
Sequential transitions remain the default.

## Runtime contract

At out-start, the router measures and fixed-pins the outgoing animator with
temporary inline positioning and disabled pointer events. The incoming route
takes the normal layout slot immediately, so the two roots can cross-fade
without a layout jump or injected wrapper.

The router starts but does not await the outgoing animation before mounting and
committing the incoming route. Hook order in the window is `viewWillHide` →
newcomer `mounted`/`viewWillShow` during the fade; `didHide`/`didShow` fire on
each side's settle, with relative order unspecified.

Only one leaver may remain. A newer navigation destroys an in-flight outgoing
view synchronously before beginning the next transition. Animation/hook
failures are contained and converge on final mounted state.

The effective mode is resolved destination-first: route override, then
view/layout class override, then app default. This avoids merging conflicting
source/destination preferences.

The View Transitions API is not used; Puzzle keeps live WAAPI-driven views and
the same lifecycle field contract as sequential mode.
