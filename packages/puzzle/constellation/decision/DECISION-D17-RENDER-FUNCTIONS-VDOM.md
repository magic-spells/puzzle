---
name: "D17 — Rendering model: compiled render functions + runtime virtual DOM; no shadow DOM"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - DOC-VIEW-LIFECYCLE
---

# D17 — Rendering model: compiled render functions + runtime virtual DOM; no shadow DOM

Settled. See [[DOC-VIEW-LIFECYCLE]] §1. Templates compile to render functions returning ViewNode trees; a runtime diff/patch applies updates, on light DOM (no shadow DOM).

## Context
The framework needed a rendering/reactivity model that a thin Go compiler could target while keeping the compiler-free Phase 1 fixture strategy viable.

## Decision
Templates compile to render functions returning ViewNode trees; a runtime diff/patch applies updates.

## Alternatives rejected
- **Shadow DOM / custom elements** — breaks Tailwind-first global styling, complicates events, and buys nothing (isolation comes from per-component vdom subtrees).
- **Svelte-style compiled DOM mutations** — moves per-binding dependency tracking into the compiler, exactly the complexity our thin Go compiler avoids; runtime-only reactivity is also what makes the compiler-free Phase 1 fixture strategy possible.

## Consequences
The framework's isolation, styling, and event stories all assume **light DOM**.
