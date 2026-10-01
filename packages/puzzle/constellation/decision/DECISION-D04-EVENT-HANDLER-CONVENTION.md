---
name: "D4 — Event handler convention: bare identifier vs call expression"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-CODEGEN
  - DOC-EVENTS
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DECISION-D38-EVENT-MODIFIERS
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
---

# D4 — Event handler convention: bare name vs call expression

Enforced by [[DOC-SPEC-TEMPLATE]] §5.

## Decision
- `@click={ handler }` (bare name) invokes the component's `events.handler(event)`.
- `@click={ handler(todo) }` (call) compiles to `(event) => this.events.handler(todo)` — evaluated at event time, `event` in scope, the handler receives exactly the written arguments.

Modifiers (`@keydown:enter`) are [[DECISION-D38-EVENT-MODIFIERS]]; the same wrapper serves callback props on component tags ([[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]]).

## Alternatives rejected
- Curried handlers (`(todo) => () => {…}`) — one closure per render and a confusing shape.
