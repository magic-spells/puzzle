---
name: 'D16 — Component composition: content markers + callback props; no `$emit`'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - DOC-EVENTS
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D18-PER-NODE-LISTENERS
code_refs:
  - compiler/internal/parser/parser.go
  - compiler/internal/parser/ast.go
  - compiler/internal/codegen/codegen.go
---

# D16 — Component composition: content markers + callback props; no `$emit`

Settled. Reusable components get two composition primitives — content markers and callback props — and no `$emit` dispatch system. (Note: the source log numbers this entry D16 but places it after D19.)

## Context
v1 reusable components needed a composition story: how children compose into a component, and how a child communicates back to its parent.

## Decision
1. **Content markers.** Children written at the call site (`<Card><p>body</p></Card>`) render at the component's default marker; a component may also declare named positions and have the call site fill them. The same vnode composition built for layout outlets covers both, which is what made the primitive cheap. The marker spelling is capitalized — `<Children/>`, `<Slot name="x"/>`, `<Slot/>` — and a lowercase `<slot>`/`<children>` is a positioned compile error steering to it; [[DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS]] owns that grammar, and a paired marker body is fallback content ([[DECISION-D141-MARKER-FALLBACK-BODIES]]).
2. **Callback props** — `@save={ handleSave }` on a **component tag** passes the (wrapped) handler to the child as the prop `save`; the child receives it through `data(params, props)` and invokes it like any function (`props.save(payload)`). DOM listeners belong to the child's own template — `@click` on `<Button>` is the `click` callback prop, not a DOM listener on the child's root element.

## Alternatives rejected
- **A `this.$emit('event', data)` dispatch system** with inter-component bubbling — the callback-prop pattern makes it unnecessary, and it would reintroduce bus-like indirection the minimal-ctx design avoids ([[DECISION-D08-MINIMAL-CONFIG]], [[DECISION-D18-PER-NODE-LISTENERS]]). Revisitable post-v1 if composition patterns demand it.
- **Scoped slots** — a marker cannot pass data back out to the call site; still not shipped.
