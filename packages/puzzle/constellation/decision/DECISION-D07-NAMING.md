---
name: 'D7 — Naming: `PuzzleApp`, `app.mount()`, the `functions` config key'
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-FORMATTERS
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
  - DECISION-D199-UPGRADE-PASS
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D7 — Naming: `PuzzleApp`, `app.mount()`, the `functions` config key

Enforced by [[DOC-SPEC-ANATOMY]] §1–2.

## Decision
- The application class is `PuzzleApp`, which leaves the `Puzzle` name to the schema-builder namespace ([[DECISION-D05-SCHEMA-BUILDERS]]).
- An app starts with `app.mount()` and stops with `app.unmount()`.
- The app's template functions are registered through the `functions` config key (and, in a static build, `app/functions.js`). Templates call them as functions, `name(value, …)` ([[DECISION-D176-EXPRESSION-LANGUAGE]], [[DECISION-D174-FUNCTION-LIBRARY]]). Compiled code reaches the registry as `ctx.formatters` (`__f`); that internal name stays, since no app writes it. The pre-0.10 `formatters` key throws, naming `functions` and `puzzle check --fix` ([[DECISION-D199-UPGRADE-PASS]]).

## Alternatives rejected
- Naming the app class `Puzzle` — collides with the builder namespace.
- `app.run()` — `mount()`/`unmount()` pair more clearly.
- Keeping `formatters` as the config key — every other surface (templates, docs, errors) calls these functions, so the key was the one place an author met a second word for the same thing.
- Renaming `ctx.formatters` and the registry with it — internal, compiler-facing names no app writes; renaming them would churn compiled output for no reader.
