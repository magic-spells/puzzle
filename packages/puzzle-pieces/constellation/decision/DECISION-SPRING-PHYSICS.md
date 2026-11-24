---
name: Wrapped pieces get their engines from the wrapped package
status: verified
connections:
  - DOC-REGISTRY
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-COPY-IN-DISTRIBUTION
  - PLAN-PROJECT
verified_at: '2026-11-22T04:55:57.776Z'
verified_sha: 7d87c388e0bdf432633490dddc9c034bd59f6e0d
---

# Wrapped pieces get their engines from the wrapped package

## Context

Sheet needs spring physics and frame timing for drag and snap; BottomSheet needs spring
physics. `@magic-spells/physics-engine` and `@magic-spells/frame-engine` are plain, DOM-free
JavaScript, so a piece could list them as npm dependencies under
[[DECISION-COPY-IN-DISTRIBUTION]].

## Decision

No piece declares `@magic-spells/physics-engine` or `@magic-spells/frame-engine`. Sheet
and BottomSheet wrap `@magic-spells/sheet` and `@magic-spells/bottom-sheet`
([[DECISION-WRAP-WEB-COMPONENTS]]), and those packages bring their own engines. A piece
declares an engine only when it is a port that drives the engine itself, as the morph
pickers (DatePicker, EmojiPicker, EmojiPickerSimple) do with `@magic-spells/morph-engine`.

## Alternatives rejected

- **A ported BottomSheet that declares `physics-engine` and drives it from the `.pzl`** —
  rejected with the port: the wrapped package owns the drag and snap math, and its fixes
  reach the app through a version bump.

## Consequences

- `puzzle add piece sheet` and `bottom-sheet` print an npm install of only the wrapped
  package and its `@magic-spells/dialog-panel` peer; npm installs the engines as that
  package's own dependencies.
- The engine version is the wrapped package's choice, not a registry floor.
