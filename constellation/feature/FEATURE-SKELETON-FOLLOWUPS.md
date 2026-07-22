---
name: "v1.20 — Skeleton follow-ups (anti-flash hold; error slot won't-build)"
status: verified
connections:
  - DECISION-D52-SKELETON-ANTIFLASH
  - DECISION-D39-SKELETON
  - FEATURE-V1-8-SKELETONS
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-PUZZLE-FILE
  - DOC-SPEC
verified_at: '2026-07-12T00:14:51.161Z'
notes:
  - kind: verified
    text: >-
      Verified at the merged main sha: min-duration hold reviewed against SPEC §16 v1.20 paragraphs
      at ship (loaded flips at swap, last-wins, destroy cancels; parser/codegen byte-identity for
      absent/0); tests/skeleton-antiflash.test.js (5) + Go parser/codegen cases + full suite green
      at this sha (480 vitest + all Go).
---

# v1.20 — Skeleton follow-ups

Both items [[FEATURE-V1-8-SKELETONS]] left out, resolved by
[[DECISION-D52-SKELETON-ANTIFLASH]]: one shipped, one settled won't-build.
Contract in [[DOC-SPEC]] §16 (v1.20 paragraphs).

## Intent

Close the two acknowledged D39 gaps without weakening its core stance
(skeleton = first-load affordance; error presentation belongs to the real
template).

## Scope

**In (shipped) — anti-flash hold:** `<puzzle-skeleton min-duration="300">` —
the section tag's only legal attribute (static unsigned integer, ms). Once the
skeleton has rendered, the loaded swap is held until the duration has elapsed;
`loaded` flips at swap time; last-wins preserved (one swap at expiry with the
latest data); destroy cancels the hold. Absent/0 = v1.8 byte-identical
(existing goldens and skeleton tests unchanged). Compiled as a
`skeletonMinDuration` prototype assignment beside `renderSkeleton`.

**Settled won't-build (D52):** the error slot — a declarative error section
couldn't read the error (only `created()`-seeded state is visible in a
non-data render); the documented catch-in-`data()`/error-model pattern stands,
now shown in [[DOC-PUZZLE-FILE]]. Delay-before-show rejected outright (blank
window the D19 immediate-commit exists to prevent). Skeletons-on-refresh stays
deliberately closed.

## Outcome

Shipped in v1.20. Parser (one sanctioned attribute + errors), codegen (one
conditional prototype assignment + golden), PuzzleView (hold timer);
`tests/skeleton-antiflash.test.js` (5 tests) + Go parser/codegen cases. Router
untouched. Full suite green: 465 vitest + all Go packages.
