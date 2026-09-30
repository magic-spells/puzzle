---
name: "D23 — Derived-from-local-UI state re-runs data() explicitly via this.refresh()"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-USER-GUIDE
  - DOC-SPEC-ANATOMY
---

# D23 — Local UI state that feeds `data()` re-runs it explicitly with `this.refresh()`

## Decision
`setData()` writes local state and re-renders but never re-runs `data()` ([[DOC-SPEC-ANATOMY]] §4). When local UI state feeds values derived in `data()` — a filter tab narrowing a list — the pattern is `this.setData(…)` followed by `this.refresh()`. `examples/todos` `Home.pzl` does exactly this for its filter.

## Alternatives rejected
- `setData()` re-running `data()` automatically — breaks the `setData` contract and re-runs `data()` (and its fetches) on every keystroke.
- Moving pure UI state into the store — heavyweight.
