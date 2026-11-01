---
name: "D23 — Derived-from-local-UI state re-runs data() explicitly via this.refresh()"
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-USER-GUIDE
  - DOC-SPEC-ANATOMY
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D23 — Local UI state that feeds `data()` re-runs it explicitly with `this.refresh()`

## Decision
`setData()` writes local state and re-renders but never re-runs `data()` ([[DOC-SPEC-ANATOMY]] §4). When local UI state feeds values derived in `data()` — a filter tab narrowing a list — the pattern is `this.setData(…)` followed by `this.refresh()`. `examples/todos` `Home.pzl` does exactly this for its filter.

## Alternatives rejected
- `setData()` re-running `data()` automatically — breaks the `setData` contract and re-runs `data()` (and its fetches) on every keystroke.
- Moving pure UI state into the store — heavyweight.
