---
name: Port DOM-free sheet motion libraries
status: built
branch: release/0.5.0
connections:
  - DOC-REGISTRY
  - DECISION-SPRING-PHYSICS
  - PLAN-PROJECT
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
