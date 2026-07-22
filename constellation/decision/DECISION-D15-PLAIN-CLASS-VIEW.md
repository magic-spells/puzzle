---
name: "D15 — `PuzzleView` is a plain class, not a web component"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-CODE-REVIEW
  - DECISION-D17-RENDER-FUNCTIONS-VDOM
---

# D15 — `PuzzleView` is a plain class, not a web component

Settled — recommended by [[DOC-CODE-REVIEW]], adopted with the Phase 1 kernel. `PuzzleView` is a plain class holding `ctx`/data/subscriptions/update-scheduling; the ViewManager owns all DOM mounting, and `<puzzle-view>` survives only as the template root element name.

## Context
The prototype's `PuzzleView extends HTMLElement` makes `new Subclass(ctx)` throw `Illegal constructor` without per-class `customElements.define()` calls that nothing performs, and `disconnectedCallback` destroys components on any DOM reparent.

## Decision
In the compile-to-render-function model ([[DECISION-D17-RENDER-FUNCTIONS-VDOM]]), custom elements buy nothing: `PuzzleView` is a plain class holding `ctx`/data/subscriptions/update-scheduling, and the ViewManager owns all DOM mounting. `<puzzle-view>` survives only as the template root element name.

## Alternatives rejected
- **`PuzzleView extends HTMLElement`** (the prototype) — throws `Illegal constructor`, requires unperformed `customElements.define()` calls, and destroys components on any DOM reparent via `disconnectedCallback`.
- **Registering an inert class** via `customElements.define('puzzle-view', ...)` — weighed and deferred. `<puzzle-view>` stays an *unregistered* custom-element-style tag (valid HTML by the hyphen rule, fully stylable/animatable, same pattern as Angular's `<app-root>`). Registration buys nothing today, adds the global once-only-define footgun, and invites behavior onto browser lifecycle callbacks (the prototype's exact failure mode). It is a five-line, non-breaking addition later if a concrete need appears (e.g. detecting external DOM removal); the reverse — unregistering — is impossible.
