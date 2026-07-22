---
name: "D1 — SPA-only, client-side-rendering framework"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DOC-SPEC
  - COMPONENT-PUZZLE-APP
---

# D1 — SPA-only, client-side-rendering framework

The founding decision: Puzzle targets single-page applications exclusively — no SSR, no hydration, no universal rendering.

## Context
A new framework must decide up front what rendering targets it serves. Server-side rendering, hydration, and universal rendering all impose weight on the runtime and complexity in the compiler output.

## Decision
Puzzle targets single-page applications exclusively: no SSR, no hydration, no universal rendering.

## Alternatives rejected
- SSR / hydration / universal rendering — rejected as out of scope for a small, simple framework.

## Consequences
This keeps the runtime small (~15KB target), the mental model simple, and the compiler output free of server concerns.
