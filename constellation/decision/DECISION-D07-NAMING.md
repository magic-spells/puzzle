---
name: "D7 — Naming: `PuzzleApp`, `app.mount()`, \"formatters\""
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-FORMATTERS
  - DOC-SPEC
---

# D7 — Naming: `PuzzleApp`, `app.mount()`, "formatters"

Settled per [[DOC-SPEC]] §1, §2, §10. The application class is `PuzzleApp`, apps start with `app.mount()`, and the transformation registry is called **formatters** everywhere.

## Context
The prototype used various names: the `Puzzle` name was taken by the app, apps started with `app.run()`, and the template transformation registry was called "filters".

## Decision
- The application class is `PuzzleApp` (frees the `Puzzle` name for the schema-builder namespace).
- Apps start with `app.mount()`; `app.run()` is removed.
- The template transformation registry is called **formatters** everywhere (config key, `ctx.formatters`, compiler-emitted references).

## Alternatives rejected
- Naming the app class `Puzzle` — rejected to free the `Puzzle` name for the schema-builder namespace (D5).
- `app.run()` — removed in favor of `app.mount()`.
- The prototype's "filters" naming — retired; `client-runtime/filters.js` gets renamed in Phase 1.

## Consequences
The "filters" naming is retired everywhere in favor of "formatters"; `client-runtime/filters.js` is renamed in Phase 1.
