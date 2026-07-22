---
name: "D8 — Minimal v1 config surface"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-APP
  - DOC-SPEC
---

# D8 — Minimal v1 config surface

Settled per [[DOC-SPEC]] §2. The v1 `PuzzleApp` config is exactly `{ target, routes, models, formatters, apiURL }` — nothing else.

## Context
The prototype had a kitchen-sink config that implied months of runtime work irrelevant to proving the framework.

## Decision
`new PuzzleApp({ target, routes, models, formatters, apiURL })` — nothing else.

## Alternatives rejected
- The prototype's kitchen-sink config — app-level `settings`, `computed`, global `events` (incl. keyboard-shortcut strings), `methods`, and app lifecycle hooks are all deferred. Rationale: it implied months of runtime work irrelevant to proving the framework.

## Consequences
App-level `settings`, `computed`, global `events`, `methods`, and app lifecycle hooks are deferred. (Later, `scrollBehavior` becomes the first amendment to this §2 config surface in v1.5 — see [[DECISION-D33-ROUTER-SCROLL]].)
