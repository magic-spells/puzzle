---
name: Puzzle Monorepo
connected_repos:
  - name: puzzle
    path: packages/puzzle
    description: The Puzzle framework plan (runtime, Go compiler, CLI, examples) — the main plan, 355 cards
  - name: puzzle-pieces
    path: packages/puzzle-pieces
    description: The pieces registry plan (npm, version locked to the framework)
---

# Puzzle Monorepo

Monorepo shell — this plan is a **signpost only**. The real plans live in the packages:

- `repo=puzzle` → `packages/puzzle` — the framework (runtime, Go compiler, CLI, examples): the main plan
- `repo=puzzle-pieces` → `packages/puzzle-pieces` — the pieces registry

Do not create cards here; address the package plans with `repo=<name>` on any constellation tool. Packages without a `constellation/` folder (puzzle-devtools, puzzle-eslint, puzzle-prettier) have no plan by design.
