---
name: D62 — @event handlers emit instance- or row-cached closures
status: verified
verified_at: '2026-11-01T19:23:12.785Z'
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D38-EVENT-MODIFIERS
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC
code_refs:
  - compiler/internal/codegen/codegen.go
  - compiler/internal/codegen/lower.go
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D62 — `@event` handlers emit cached closures wherever the capture allows

A fresh arrow per render defeats `patchComponent`'s prop equality (a child taking a callback prop re-runs `data()` on every parent render) and churns DOM listeners on every patch. So codegen caches each handler closure on whatever object outlives the render.

## Decision

The compiler decides per site in `lowerer.handler` (`lower.go`), reading the expression tree — the arguments' template-binding refs, data roots and function calls — never source text (a string literal containing `"__d."` still caches).

- **Instance cache** — the bare form `@click={ h }`, or a call whose arguments read only literals, `event` and its chains, arrow params and allowed globals: `((this.__h ??= {})[N] ??= (event) => this.events.h(event))`. `N` is a per-file site counter shared by `render()` and `renderSkeleton()`, so an unchanged file recompiles byte-stable.
- **Row cache** — inside a lowered item-form `{#for}` (D170), arguments that read only loop bindings cache on the row's live scope: `(s.h0 ??= (event) => this.events.deleteTodo(s.item))`. `s.item` is the row's current item, so one closure survives updates, reorders and same-key replacement. Every captured binding must belong to a lowered loop; a range-loop variable or `<Snippet>` parameter is rebound per iteration, so its closure stays fresh.
- **Fresh closure** — arguments that read a data root (`__d`, a per-render snapshot) or call a library function (`__f`); caching would freeze them. Those roots join the loop site's dirty mask. A handler-valued conditional (`c ? h1 : h2`) is never cached.
- `this.__h` is a reserved instance field beside `__d`/`__f`. The `:once` spent flag lives on the element's listener record, not the function.

## Alternatives rejected

- **Prop equality treats functions as equal / compares source** — a closure over changing data must count as a changed prop; any such hack silently reintroduces stale handlers.
- **Module-level hoisting** — handlers need instance `this`.
- **Leave loop captures fresh** — measured: every row re-ran `data()` for one changed record, and listeners churned on every render.

## Gotchas

- A child whose props are all static, cached or memoized (D64) skips `data()` on a parent render. An authored per-render closure still pays the full cost.
- `tests/component-prop-bailout.test.js` pins both directions (compiled row shape wakes one child; a hand-written fresh prop wakes all) plus the comparator's boundaries. "Fixing" the fresh-prop cost by deep-comparing props or exempting functions must fail that test. Browser A/B: [[DOC-STRESS-EXAMPLE]] `?handlers=inline|stable`.
