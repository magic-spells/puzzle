---
name: "D11 — Project layout: `app/` source, `dist/` output"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
---

# D11 — Project layout: `app/` source, `dist/` output

Enforced by [[DOC-SPEC-ANATOMY]] §11.

## Decision
- App source lives in `app/`; the entry is `app/app.js`, or `app/app.ts` in a TypeScript app ([[DECISION-D54-TYPESCRIPT-SCRIPTS]]).
- Build output goes to `dist/`.
- `examples/todos/` is the canonical reference application; its hand-compiled fixture is golden file #1 ([[FILE-TESTS-FIXTURES-TODOS-HOME-COMPILED]]).

## Alternatives rejected
- `./src` (the prototype default) — `app/` groups views, layouts, components, models and styles under one app-shaped root.
