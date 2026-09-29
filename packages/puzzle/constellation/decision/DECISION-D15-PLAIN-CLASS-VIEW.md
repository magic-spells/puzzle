---
name: 'D15 — One component model: classes extending a plain `PuzzleView` (not a web component)'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - DECISION-D17-RENDER-FUNCTIONS-VDOM
  - DOC-SPEC-ANATOMY
code_refs:
  - client-runtime/views/PuzzleView.js
---

# D15 — One component model: classes extending a plain `PuzzleView`

## Decision
Every `.pzl` component is a class extending `PuzzleView` ([[DOC-SPEC-ANATOMY]] §1) — there is no second, closure-based factory. `PuzzleView` is a plain class holding `ctx`, data, subscriptions and update scheduling; the ViewManager owns all DOM mounting. `<puzzle-view>` is only the template root tag, rendered as an **unregistered** custom-element-style tag for views and layouts ([[DECISION-D20-PUZZLE-VIEW-ELEMENT]]).

## Why
In the render-function model ([[DECISION-D17-RENDER-FUNCTIONS-VDOM]]) custom elements buy nothing. One component model means one documentation story and one compiler target.

## Alternatives rejected
- `PuzzleView extends HTMLElement` — `new Subclass(ctx)` throws `Illegal constructor` without per-class `customElements.define()`, and `disconnectedCallback` destroys a component on any DOM reparent.
- Registering an inert `customElements.define('puzzle-view', …)` — buys nothing, adds the global define-once footgun, and invites behavior onto browser lifecycle callbacks. It is a small non-breaking addition later if a concrete need appears; unregistering is impossible.
- A closure-based `Puzzle.createView` factory beside the class — two component models.
