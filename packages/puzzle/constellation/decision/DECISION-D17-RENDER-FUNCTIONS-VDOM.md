---
name: "D17 — Rendering model: compiled render functions + runtime virtual DOM; no shadow DOM"
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - DOC-VIEW-LIFECYCLE
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D17 — Compiled render functions + a runtime virtual DOM, on light DOM

See [[DOC-VIEW-LIFECYCLE]] §1.

## Decision
Templates compile to render functions returning ViewNode trees; a runtime diff/patch applies updates to light DOM. All reactivity stays in the runtime. The VDOM is **compiler-informed**: static subtrees are built once per instance or loop row and returned by reference, an item-form `{#for}` is a persistent list block that reuses unchanged rows, and `patch()` short-circuits when both sides are the same object ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]). One vnode encoding serves both creation and update.

## Consequences
Isolation, styling and events all assume light DOM; isolation comes from per-component vdom subtrees.

## Alternatives rejected

- **Shadow DOM / custom elements** — breaks Tailwind-first global styling, complicates events, buys nothing.
- **Svelte-style compiled DOM mutations** — puts per-binding dependency tracking in the thin Go compiler, and measured larger bundles on real templates (static HTML strings compress worse than vnode calls) until an app has many templates. D170's incremental VDOM took most of the CPU win at no byte cost.
