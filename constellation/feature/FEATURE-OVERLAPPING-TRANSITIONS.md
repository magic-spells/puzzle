---
name: Cross-fade / overlapping route transitions
status: verified
verified_at: '2026-07-22T01:03:43.287Z'
verified_sha: 5f16d58d1472c1c1f8f4266e9cc4c0ae40ad14d1
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
      Verified at 373f0e6: tests/router-overlap.test.js (8 — pin styles + coexistence, hook
      ordering, sequential-default guard, mid-overlap interruption with exactly-once destroys,
      reused-layout patch-driven teardown, instant-out, config validation) + tests/app.test.js
      passthrough case; full suite 532 vitest + all Go packages green at this sha. Review pass by
      the orchestrator added the settle-handler .catch (a throwing viewWillHide/viewDidHide would
      otherwise strand the pinned leaver + surface an unhandled rejection) and the PuzzleApp
      transitionMode conditional passthrough.
    sha: 373f0e60d7cc827411dbb7a8fcdfa7185f86be45
  - kind: verified
    text: >-
      v1.32 (PR #40): overlap semantics unchanged by the hardening pass (the router diffs —
      #observeMount, #runPendingPush finally, #pendingIndex, departure-scroll capture — are all
      orthogonal to the pin/concurrent-play machinery). Now exercised in REAL browsers: the
      Playwright suite asserts outgoing+incoming coexist mid-transition and no inline position:fixed
      pin survives settle, on Chromium AND WebKit. Documented as EXPERIMENTAL for 0.1.0 in README
      (interaction-matrix caution: overlap×morph, overlap×nested-reused-layout).
    sha: b28705330ce4399f214ddd34309f01fd6a655b86
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
