---
name: "D2 — Class-based components; `Puzzle.createView` removed"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
---

# D2 — Class-based components; `Puzzle.createView` removed

Settled; enforced by [[DOC-SPEC]] §1. v1 has one component model — class-based `PuzzleView` — and the closure-based factory is deleted.

## Context
The prototype runtime carried two view implementations: a class-based `PuzzleView` and a closure-based `Puzzle.createView` factory. Two implementations meant two documentation stories and two compiler targets.

## Decision
v1 is class-based only. The `Puzzle.createView` factory (and the duplicate view class inside `client-runtime/main.js`) is deleted. One component model, one documentation story, one compiler target.

## Alternatives rejected
- Keeping the closure-based `Puzzle.createView` factory alongside the class model — rejected to collapse to a single component model.

## Consequences
Settled per [[DOC-SPEC]] §1. The duplicate view class inside `client-runtime/main.js` is removed.
