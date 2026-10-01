---
name: "D17 — Rendering model: compiled render functions + runtime virtual DOM; no shadow DOM"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - DOC-VIEW-LIFECYCLE
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
---

# D17 — Compiled render functions + a runtime virtual DOM, on light DOM

See [[DOC-VIEW-LIFECYCLE]] §1.

## Decision
Templates compile to render functions returning ViewNode trees; a runtime diff/patch applies updates to light DOM. All reactivity stays in the runtime. The VDOM is **compiler-informed**: static subtrees are built once per instance or loop row and returned by reference, an item-form `{#for}` is a persistent list block that reuses unchanged rows, and `patch()` short-circuits when both sides are the same object ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]). One vnode encoding serves both creation and update.

## Consequences
Isolation, styling and events all assume light DOM; isolation comes from per-component vdom subtrees.

## Alternatives rejected
- **Shadow DOM / custom elements** — breaks Tailwind-first global styling, complicates events, buys nothing.
- **Svelte-style compiled DOM mutations** — puts per-binding dependency tracking in the thin Go compiler. Measured 2026-09-10 on five real templates: +25–27% gzip even with every emitter lever, because the static HTML string compresses worse than vnode calls; break-even around 13 templates. D170 took most of its CPU win at no byte cost.
