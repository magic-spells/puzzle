---
name: D18 — Event listeners are per-node; no document-level delegation
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-VIEW-MANAGER
  - DOC-VIEW-LIFECYCLE
  - DOC-EVENTS
---

# D18 — Event listeners are per-node; no document-level delegation

See [[DOC-VIEW-LIFECYCLE]] §2.

## Decision
`@event={…}` compiles to an `'@event'` vnode attr; the ViewManager attaches a real listener on that element and swaps or removes it on patch (leak-free, tested). Modifiers wrap the listener at runtime ([[DECISION-D38-EVENT-MODIFIERS]]); handler identity is cached per site ([[DECISION-D62-HANDLER-CACHING]]).

## Alternatives rejected
- **Document-level delegation** — its wins don't show at this scale, and it costs a target-routing layer plus special cases for non-bubbling events. The component API (`events = {}`, `@event`) is delegation-agnostic, so it stays revisitable without breaking users.
