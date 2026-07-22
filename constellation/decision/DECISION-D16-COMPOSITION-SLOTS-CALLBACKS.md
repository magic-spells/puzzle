---
name: "D16 — Component composition: default `<slot />` + callback props; no `$emit`"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - DOC-EVENTS
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D18-PER-NODE-LISTENERS
---

# D16 — Component composition: default `<slot />` + callback props; no `$emit`

Settled. v1 reusable components get two composition primitives — a default `<slot />` and callback props — and no `$emit` dispatch system. (Note: the source log numbers this entry D16 but places it after D19.)

## Context
v1 reusable components needed a composition story: how children compose into a component, and how a child communicates back to its parent.

## Decision
v1 reusable components get two composition primitives:

1. **Default `<slot />`** — children written at the call site (`<Card><p>body</p></Card>`) render at the child's `<slot />`. Cheap: the same vnode composition built for layout `<Slot/>` covers it. Named slots stay deferred.
2. **Callback props** — `@save={ handleSave }` on a **component tag** passes the (wrapped) handler to the child as the prop `save`; the child receives it through `data(params, props)` and invokes it like any function (`props.save(payload)`). DOM listeners belong to the child's own template — `@click` on `<Button>` is the `click` callback prop, not a DOM listener on the child's root element.

## Alternatives rejected
- **A `this.$emit('event', data)` dispatch system** with inter-component bubbling — the callback-prop pattern makes it unnecessary, and it would reintroduce bus-like indirection the minimal-ctx design avoids ([[DECISION-D08-MINIMAL-CONFIG]], [[DECISION-D18-PER-NODE-LISTENERS]]). Revisitable post-v1 if composition patterns demand it.
- **Named slots** — deferred.
