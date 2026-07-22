---
name: "D52 — Skeleton anti-flash: opt-in min-duration hold; the error slot resolves won't-build (v1.20)"
status: verified
connections:
  - DECISION-D39-SKELETON
  - DECISION-D19-NAVIGATION-COMMIT
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - FEATURE-SKELETON-FOLLOWUPS
  - DOC-PUZZLE-FILE
  - DOC-SPEC
verified_at: '2026-07-12T00:15:02.801Z'
verified_sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
notes:
  - kind: verified
    text: >-
      Decision implemented as written (min-duration hold shipped; error slot settled won't-build;
      delay-before-show rejected) and verified at the merged main sha (480 vitest + all Go green).
      One refinement recorded on COMPONENT-PUZZLE-VIEW: loaded flips at swap time, coinciding with
      data-commit when no hold is configured.
    sha: 60276918bffe8a470ff6b9e8ff7eb926e994b9e6
---

# D52 — Skeleton anti-flash: opt-in `min-duration` hold; the error slot resolves won't-build (v1.20)

Closes both items [[DECISION-D39-SKELETON]] left out of v1.8. One ships, one is
rejected on the merits. See [[DOC-SPEC]] §16 (v1.20 amendment inside the section).

## Context
v1.8's exclusions: (1) a declarative error slot for a `data()` rejection while the
skeleton is up, and (2) anti-flash heuristics for fast-but-not-instant data. The
backlog card flagged that the error-slot half "must justify itself against 'it
already works'" and that delay-before-show and minimum-display solve *different*
flashes.

## Decision
- **Anti-flash = minimum-display-once-shown, opt-in via one static attribute.**
  `<puzzle-skeleton min-duration="300">`: once the skeleton has rendered, the
  loaded swap is held until at least that many ms have elapsed since it appeared;
  data committing later than the hold swaps immediately (unchanged). Last-wins
  semantics are preserved — refreshes landing during the hold just update the
  pending model; one swap happens at hold expiry with the latest data. Destroy
  during the hold cancels it. Default absent = 0 = v1.8 behavior byte-identical.
- **Delay-before-show is REJECTED**, not deferred. A show-delay means the mounted
  view renders an **empty root** during the delay window — a blank state that
  cannot otherwise occur (skeleton-less views gate the commit; skeleton views show
  the skeleton). Trading a brief skeleton for a brief *blank* is strictly worse,
  and the D19 immediate-commit narrowing exists precisely so a committed URL always
  points at *declared* content. The standard two-knob pattern (delay + min) is a
  spinner-era heuristic; a skeleton that appears instantly and holds briefly reads
  as stable.
- **The attribute is the section tag's ONLY legal attribute.** v1.8's "no
  attributes (compile error)" narrows to "only `min-duration`, static unsigned
  integer" — a dynamic/interpolated value, any other attribute, or a malformed
  number stays/becomes a compile error. Codegen emits it as a prototype assignment
  beside `renderSkeleton` (`Name.prototype.skeletonMinDuration = 300`); the runtime
  reads `this.skeletonMinDuration ?? 0`. Skeleton-less files and attribute-less
  skeletons emit byte-identical output.
- **The error slot resolves WON'T-BUILD.** D39's stance stands and is now settled
  rather than deferred: error presentation belongs to the real template via the
  documented pattern — catch in `data()`, return an error model, render error
  states with ordinary template conditionals. A declarative error section cannot
  even *name* the failure: only `created()`-seeded state is readable in a
  non-data render, so showing the error object would demand a new plumbing API —
  a fifth-section-sized cost for a worse version of what `data()` already does.
  [[DOC-PUZZLE-FILE]] now shows the catch-in-`data()` pattern next to the skeleton
  docs. (The third v1.8 exclusion — skeletons on refresh — was deliberate, stays
  closed, and needs new evidence, not this card.)

## Alternatives rejected
- Delay-before-show (blank window, above); a fixed always-on heuristic (any
  hardcoded number is wrong for someone, and v1.8 byte-compatibility is the
  contract); a config-object surface (`skeleton: { min }` in PuzzleApp) — the
  section is per-component, so the knob belongs on the section.
- Error slot (won't-build, above); a `data-puzzle-error` attribute/class hook on
  the stuck root — styling a permanently-stuck skeleton is treating the symptom.

## Consequences
Parser (one sanctioned attribute) + codegen (one extra prototype assignment) +
PuzzleView (hold timer around the loaded swap). Router untouched — the hold
composes with D19 immediate-commit trivially (the skeleton is up either way; only
the swap moment moves). Files not using `min-duration` compile and behave
byte-identically to v1.8.
