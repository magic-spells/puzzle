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

The virtual DOM is **compiler-informed**: the emitter knows which parts of a tree cannot change and says so in what it emits, while all reactivity stays in the runtime. Static subtrees are built once per instance or per loop row and returned by reference; an item-form `{#for}` is a persistent list block that returns the cached row subtree for a row whose inputs did not change; `patch()` short-circuits when both sides are the same object, which is what makes those cached subtrees free to reconcile ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]). One vnode encoding still serves both creation and update — that is the property the alternatives below give up.

## Alternatives rejected

- **Shadow DOM / custom elements** — breaks Tailwind-first global styling, complicates events, and buys nothing (isolation comes from per-component vdom subtrees).
- **Svelte-style compiled DOM mutations** — moves per-binding dependency tracking into the compiler, exactly the complexity our thin Go compiler avoids; runtime-only reactivity is also what makes the compiler-free Phase 1 fixture strategy possible. Re-examined and **measured** on 2026-09-10 against five real templates (three todos fixtures, the two largest music templates), hand-written in the compiled shape and minified + gzipped: **+25–27% gzip in a bundle even with every emitter lever** (table-driven bindings, walk descriptor, constant folding, Solid-style tag tightening), because the floor is the static HTML string itself — closing tags and attribute syntax compress worse than `,[])` — plus a shared block runtime. Break-even lands around 13 templates. The written-up design was removed with the 0.8.0 planning documents (the measurements here are its record); most of its CPU win was taken by D170 instead, at no byte cost.

## Consequences
The framework's isolation, styling, and event stories all assume **light DOM**.
