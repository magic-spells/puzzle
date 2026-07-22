---
name: "D23 — Derived-from-local-UI state re-runs data() explicitly via this.refresh()"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-USER-GUIDE
---

# D23 — Derived-from-local-UI state re-runs data() explicitly via this.refresh()

Settled. When local-UI state feeds data derived in `data()`, the canonical pattern is `this.setData(...)` followed by `this.refresh()` — because `setData()` never re-runs `data()`.

## Context
`setFilter` in the canonical todos example updated `currentFilter` with `setData()`, but `filteredTodos` is derived in `data()`, and `setData()` never re-runs `data()` ([[DOC-SPEC]] §4) — so the filter tabs highlighted but the list never narrowed. This was a latent bug found while hand-compiling the golden fixture (Step 4).

## Decision
The canonical pattern for local-UI state that feeds derived data in `data()` is `this.setData(...)` followed by `this.refresh()`; `Home.pzl` and the fixture were updated.

## Alternatives rejected
- **Making `setData()` re-run `data()` automatically** — would break the documented `setData` contract and cause surprise `data()` re-runs on every keystroke.
- **Moving filter state into the store** — heavyweight for pure UI state.

## Consequences
This pattern should appear in USER_GUIDE examples ([[DOC-USER-GUIDE]]) when they're next touched.
