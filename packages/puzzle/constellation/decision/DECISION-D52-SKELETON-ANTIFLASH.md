---
name: 'D52 — Skeleton anti-flash: opt-in `min-duration` hold; no error section'
status: verified
connections:
  - DECISION-D39-SKELETON
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D145-ERROR-BOUNDARIES
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-PUZZLE-FILE
  - DOC-SPEC
  - DOC-SPEC-VIEW
verified_at: '2026-11-01T19:23:24.972Z'
code_refs:
  - client-runtime/views/PuzzleView.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D52 — Skeleton anti-flash: opt-in `min-duration` hold; no error section

A skeleton that appears for a few milliseconds reads as a flicker. The fix is an opt-in minimum display time, not a delay. See [[DOC-SPEC-VIEW]] §16.

## Decision
- **Minimum display once shown.** `<puzzle-skeleton min-duration="300">`: once the skeleton has rendered, the loaded swap waits until it has been up that many ms; data arriving later swaps immediately. Refreshes during the hold update the pending model, and one swap happens at expiry with the latest data. Destroy cancels the hold. `loaded` flips at swap time. Absent = 0. The hold only engages when a skeleton actually rendered (a hybrid takeover never shows one, [[DECISION-D39-SKELETON]]).
- **`min-duration` is the section tag's only legal attribute** — a static unsigned integer. A dynamic or malformed value, or any other attribute, is a compile error. Codegen emits `Name.prototype.skeletonMinDuration = 300` only when the attribute is given; the runtime reads `this.skeletonMinDuration ?? 0`.
- **No declarative error section (won't build).** A `data()` failure belongs to the real template (catch in `data()`, return an error model, render it with ordinary conditionals — [[DOC-PUZZLE-FILE]] shows the pattern) or, uncaught, to the app `errorView` ([[DECISION-D145-ERROR-BOUNDARIES]]). A skeleton-time error section could not even name the failure, since only `created()` state is readable there.

## Alternatives rejected
- Delay-before-show — the view would render an empty root during the delay, a blank state that otherwise cannot occur; the D19 immediate-commit narrowing exists so a committed URL always shows declared content.
- A fixed always-on heuristic, or a `PuzzleApp` config knob — any hardcoded number is wrong for someone, and the knob belongs on the per-component section.
- A `data-puzzle-error` hook on a stuck skeleton — treats the symptom.
- Skeletons on refresh — closed by [[DECISION-D39-SKELETON]]; reopening needs new evidence.
