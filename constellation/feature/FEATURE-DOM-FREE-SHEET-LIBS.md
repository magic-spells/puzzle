---
name: Port DOM-free sheet motion libraries
status: built
branch: release/0.5.0
connections:
  - DOC-REGISTRY
  - DECISION-SPRING-PHYSICS
  - PLAN-PROJECT
notes:
  - kind: state
    text: >-
      SUPERSEDED 2026-08-22 — the three libs this feature ported (registry/lib/sheet-engine.js,
      sheet-policy.js, sheet-drag.js) and their five Node suites were REMOVED when the sheet piece
      became a thin wrapper over @magic-spells/sheet (DECISION-WRAP-WEB-COMPONENTS; commit 1093ded
      on feat/sheet-wrapper). The motion, gesture and snap policy now run from the npm package and
      are tested upstream; the only sheet-related test left in this repo is
      test/sheet-wrapper.test.js (static wiring guards). sheet-math.js survives only because
      bottom-sheet (still a port at that point) imports it — it goes when bottom-sheet is converted
      (phase 2 of notes/2026-08-22-sheet-wrapper-plan.md). This card is history for how the port was
      built, not a description of current code.
  - kind: state
    text: >-
      2026-08-22 (phase 2, feat/sheet-wrapper): sheet-math.js is gone too. bottom-sheet became a
      wrapper over @magic-spells/bottom-sheet, so registry/lib/sheet-math.js, its demo copy and
      test/sheet-math.test.js were deleted and the sheet-math row was trimmed from
      test/sheet-parity.test.js (which now only asserts the two wrapper .pzl copies stay
      byte-identical). Nothing in this repo ports sheet motion any more — every suite under test/
      that named a sheet lib is deleted; test/sheet-wrapper.test.js now carries the static wiring
      guards for BOTH wrapper pieces.
---

# Port DOM-free sheet motion libraries

Bring the source sheet motion engine, policy, and drag gesture into the copy-in registry as plain JavaScript, preserving the source behavior and pure exports. This extends [[DOC-REGISTRY]] under the dependency boundary already established by [[DECISION-SPRING-PHYSICS]].

## Scope

- Add registry libraries for the sheet engine, combined scroll/snap policy, and drag gesture.
- Fold only internal source modules where required by the registry file layout.
- Port the source DOM-free Node test suites and root test harness.
- Do not change the existing sheet math or bottom-sheet implementation.

## Acceptance

- Ported assertions are byte-identical to the source; only import paths differ.
- `npm test` passes from the repository root.
- The three new registry libraries contain no `document` or `window` references.
- Motion invariants documented by the source project remain unchanged.
