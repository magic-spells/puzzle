---
name: v1.28 — Atomic location commit (D61)
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
branch: feature/d61-atomic-route-commit
connections:
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D19-NAVIGATION-COMMIT
  - COMPONENT-ROUTER
  - DOC-SPEC
  - DOC-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DOC-APP-ANATOMY
---

# v1.28 — Atomic location commit (D61)

Sequential route transitions committed URL/title/history the instant loads
resolved, BEFORE the awaited out animation — leaving a supersession window with
two known-deferred holes (phantom history entry; URL/view divergence on
doomed-nav-then-failure). Ship [[DECISION-D61-ATOMIC-LOCATION-COMMIT]]: all
location side effects move into `#swap`'s synchronous `#committing` window via
the new `#commitLocation()` helper, immediately before mount + `#commitState` —
restoring [[DECISION-D19-NAVIGATION-COMMIT]]'s stated "URL and view commit
atomically".

## Scope

- In: [[COMPONENT-ROUTER]] `#commitLocation` (moved code: pushState/base/mode
  encoding, memory stack/index, scroll-key save, title); `next` threading of
  `{ push, memoryIndex }`; comment truthing in router.js; regression tests
  (router-transitions/-overlap/-memory); doc sweep ([[DOC-SPEC]] §30 + §12/§16/
  §26 notes, [[DOC-ROUTER]], [[DOC-VIEW-LIFECYCLE]] diagram + points 1/6,
  [[DOC-APP-ANATOMY]] pipeline, CLAUDE.md lifecycle).
- Out: history rollback for pops or post-commit render throws (rejected in
  D61); any change to the D19 data gate, overlap timing, morph contract, or
  skeleton data-gate bypass.

## Acceptance (all landed)

- While a sequential out transition pends: URL, title, history.length, and
  `router.current` still show the OLD route; all flip together at the swap.
- The central case: nav A held mid-out, nav B's data() rejects → NOTHING
  committed by either, original view restored (test fails on pre-D61 code).
- A superseded push adds no history entry (winner-only growth).
- Overlap mode commits + mounts without awaiting the leave; memory-mode
  stack/index move winner-only.
- Suite 546 → 552 vitest, all green.
