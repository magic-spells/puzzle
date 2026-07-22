---
name: "D4 — Event handler convention: bare identifier vs call expression"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-CODEGEN
  - DOC-EVENTS
  - DOC-SPEC
---

# D4 — Event handler convention: bare identifier vs call expression

Settled per [[DOC-SPEC]] §5. A bare `@click={ handler }` invokes `handler(event)`; a call expression `@click={ handler(todo) }` compiles to `(event) => handler(todo)`.

## Context
Event handler syntax needs a clear rule for when the written expression is the handler versus a call made at event time. Early examples used a curried pattern.

## Decision
`@click={ handler }` (bare) invokes `handler(event)`. `@click={ handler(todo) }` (call) is compiled to `(event) => handler(todo)` — evaluated at event time, `event` in scope, handler receives exactly the written arguments.

## Alternatives rejected
- The curried pattern from early examples (`(todo) => () => {...}`) — removed.

## Consequences
Event modifiers (`@keydown:enter`) are deferred (later shipped in v1.7, see [[DECISION-D38-EVENT-MODIFIERS]]).
