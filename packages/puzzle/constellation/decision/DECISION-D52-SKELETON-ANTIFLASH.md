---
name: 'D52 — Skeleton anti-flash: opt-in `min-duration` hold; no error section'
status: verified
connections:
  - DECISION-D39-SKELETON
  - DECISION-D19-NAVIGATION-COMMIT
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-PUZZLE-FILE
  - DOC-SPEC
  - DOC-SPEC-VIEW
verified_at: '2026-07-12T00:15:02.801Z'
code_refs:
  - client-runtime/views/PuzzleView.js
---

# D52 — Skeleton anti-flash: opt-in `min-duration` hold; no error section

See [[DOC-SPEC-VIEW]] §16.

## Decision
- **Minimum display once shown.** `<puzzle-skeleton min-duration="300">`: once the skeleton has rendered, the loaded swap waits until it has been up that many ms; data arriving later swaps immediately. Refreshes during the hold update the pending model, and one swap happens at expiry with the latest data. Destroy cancels the hold. `loaded` flips at swap time. Absent = 0.
- **`min-duration` is the section tag's only legal attribute** — a static unsigned integer. A dynamic or malformed value, or any other attribute, is a compile error. Codegen emits `Name.prototype.skeletonMinDuration = 300`; the runtime reads `this.skeletonMinDuration ?? 0`.
- **No declarative error section (won't build).** Errors belong to the real template: catch in `data()`, return an error model, render it with ordinary conditionals ([[DOC-PUZZLE-FILE]] shows the pattern). A skeleton-time error section could not even name the failure, since only `created()` state is readable there.

## Alternatives rejected
- Delay-before-show — the view would render an empty root during the delay, a blank state that otherwise cannot occur; the D19 immediate-commit narrowing exists so a committed URL always shows declared content.
- A fixed always-on heuristic, or a `PuzzleApp` config knob — any hardcoded number is wrong for someone, and the knob belongs on the per-component section.
- A `data-puzzle-error` hook on a stuck skeleton — treats the symptom.
- Skeletons on refresh — closed by [[DECISION-D39-SKELETON]]; reopening needs new evidence.
