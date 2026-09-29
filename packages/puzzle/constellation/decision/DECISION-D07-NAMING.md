---
name: 'D7 — Naming: `PuzzleApp`, `app.mount()`, the `formatters` config key'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-FORMATTERS
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
---

# D7 — Naming: `PuzzleApp`, `app.mount()`, the `formatters` config key

Enforced by [[DOC-SPEC-ANATOMY]] §1–2.

## Decision
- The application class is `PuzzleApp`, which leaves the `Puzzle` name to the schema-builder namespace ([[DECISION-D05-SCHEMA-BUILDERS]]).
- An app starts with `app.mount()` and stops with `app.unmount()`.
- The app's template function library is registered through the `formatters` config key and reaches compiled code as `ctx.formatters` (`__f`). Templates call these as functions, `name(value, …)` ([[DECISION-D176-EXPRESSION-LANGUAGE]], [[DECISION-D174-STANDARD-FORMATTERS]]); the config key keeps its name.

## Alternatives rejected
- Naming the app class `Puzzle` — collides with the builder namespace.
- `app.run()` — `mount()`/`unmount()` pair more clearly.
