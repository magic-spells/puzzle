---
name: D62 — @event handlers emit instance- or row-cached closures
status: verified
verified_at: '2026-08-24T19:03:25.442Z'
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
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D62 — `@event` handlers emit cached closures wherever the capture allows

## Context

An `@event` site compiled to a fresh arrow per render defeats
`patchComponent`'s prop equality (any child taking a callback prop re-runs
`data()` on every parent render) and churns DOM listeners on every patch.

## Decision

Codegen caches the closure on whichever object outlives the render; the
compiler decides per site (`lowerer.handler` in `lower.go` reads the expression
tree, recording the arguments' template-binding refs, data roots and library
calls — never source text, so a string literal containing `"__d."` still
caches).

- **Instance cache** — the bare form `@click={ h }`, or a call whose arguments
  read nothing but literals, `event` and its chains, arrow params and allowed
  globals (all evaluated at fire time):
  `((this.__h ??= {})[N] ??= (event) => this.events.h(event))`. `N` is a
  per-file site counter shared by `render()` and `renderSkeleton()`, so an
  unchanged file recompiles byte-stable.
- **Row cache** — inside a lowered item-form `{#for}` (D170), arguments that
  read only loop bindings cache on the row's live scope:
  `(s.h0 ??= (event) => this.events.deleteTodo(s.item))`. `s.item` is the row's
  current item, so one closure survives updates, reorders and same-key
  replacement. Every captured binding must belong to a lowered loop — a
  range-loop variable or `<Snippet>` parameter is rebound per iteration, so its
  closure stays fresh.
- **Fresh closure** — arguments that read a data root (`__d`, a per-render
  snapshot) or call a library function (`__f`); caching would freeze them.
  Those roots join the loop site's dirty mask. A handler-valued conditional
  (`c ? h1 : h2`, a branch may be `null`) is never cached.

## Alternatives

- **Prop equality treats functions as equal / compares source** — rejected: a
  closure over changing data must count as a changed prop; any such hack
  reintroduces stale handlers silently.
- **Module-level hoisting** — rejected: handlers need instance `this`.
- **Leave loop captures fresh** — rejected on measurement: every row re-ran
  `data()` for one changed record (10k rows: `select-row` 42ms → 14ms script
  time, 400k → 0 listener add/remove calls over 20 renders).

## Consequences

- A child whose props are all static, cached or memoized skips `data()` on a
  parent render; a `{#for}` row's callback prop is identity-stable, so a list
  wakes only rows whose record revision changed (D170). An authored per-render
  closure still pays the old cost.
- Cached listener sites stop rebinding per patch; the `:once` spent flag lives
  on the element's listener record, not the function.
- `this.__h` is a reserved instance field alongside `__d`/`__f`; row caches
  live on row state. `??=` needs ES2021 (builds target ES2022).
- `tests/component-prop-bailout.test.js` pins both directions — the compiled
  row shape wakes one child; a hand-written fresh prop wakes all 20 with
  identical DOM — plus the comparator's boundaries (key count, `!==`, record
  revision). "Fixing" the fresh-prop cost by deep-comparing props or exempting
  functions must fail that test. Browser A/B: [[DOC-STRESS-EXAMPLE]]
  `?handlers=inline|stable`.
