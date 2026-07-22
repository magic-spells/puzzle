---
name: "D18 — Event listeners are per-node; document-level delegation rejected for v1"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-VIEW-MANAGER
  - DOC-VIEW-LIFECYCLE
  - DOC-EVENTS
---

# D18 — Event listeners are per-node; document-level delegation rejected for v1

Settled for v1. See [[DOC-VIEW-LIFECYCLE]] §2. `@event={...}` compiles to a `'@event'` vnode attr; the ViewManager attaches a real per-node listener and swaps/removes it on patch (leak-free, tested).

## Context
Early docs promised document-level event delegation; the v1 event wiring needed a decision.

## Decision
`@event={...}` compiles to a `'@event'` vnode attr; the ViewManager attaches a real listener on that element and swaps/removes it on patch (leak-free, tested).

## Alternatives rejected
- **Document-level delegation** (promised in early docs) — its wins don't materialize at v1 scale, and it costs a target-routing layer plus special cases for non-bubbling events. The component API (`events = {}`, `@event`) is delegation-agnostic, so this is revisitable post-v1 without breaking users.

## Consequences
Supersedes the "global event listeners at document level" claims in the original knowledge base.
