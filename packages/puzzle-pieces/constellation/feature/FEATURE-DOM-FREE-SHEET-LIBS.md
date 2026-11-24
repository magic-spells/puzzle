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
      No sheet motion library ships in `registry/lib/`: sheet and bottom-sheet wrap
      `@magic-spells/sheet` and `@magic-spells/bottom-sheet`, whose motion, gesture and snap policy
      are tested upstream. In this repo `test/sheet-wrapper.test.js` holds the static wiring guards
      for both wrappers, and `test/registry-parity.test.js` byte-compares every registry file with
      its demo copy. Both manifests list `styles` with dialog-panel's sheet before their own, the
      order in which `puzzle add piece` prints the `@import` lines.
---

# Port DOM-free sheet motion libraries

History: the sheet's motion libraries were ported here, then deleted when Sheet and BottomSheet became wrappers ([[DECISION-WRAP-WEB-COMPONENTS]]). The scope below is what the port covered; none of it is in `registry/lib/`.

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
