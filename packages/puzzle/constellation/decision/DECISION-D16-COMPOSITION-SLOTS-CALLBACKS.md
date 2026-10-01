---
name: 'D16 — Component composition: content markers + callback props; no `$emit`'
status: verified
verified_at: '2026-08-24T19:04:13.357Z'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-CODEGEN
  - DOC-EVENTS
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D166-SNIPPETS
code_refs:
  - compiler/internal/codegen/codegen.go
verified_sha: c809db6680eb9355961897756f54e97f1164b88f
---

# D16 — Component composition: content markers + callback props; no `$emit`

## Decision
Components compose through two primitives and nothing else:

1. **Content markers.** Children written at the call site (`<Card><p>body</p></Card>`) render at the component's `<Children/>` marker; named regions use `<Slot name="x"/>` filled by `slot="x"` children ([[DECISION-D53-NAMED-SLOTS]]). One vnode composition mechanism serves these and the router outlet. Marker grammar is [[DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS]]; fallback bodies are [[DECISION-D141-MARKER-FALLBACK-BODIES]].
2. **Callback props.** `@save={ handleSave }` on a **component tag** passes the handler to the child as the prop `save`, compiled with the same wrapper as a DOM event — `save: (event) => this.events.handleSave(…)` ([[DECISION-D04-EVENT-HANDLER-CONVENTION]]). The child receives it through `data(params, props)` and calls it (`props.save(payload)`). `@click` on `<Button>` is the `click` callback prop, not a DOM listener on the child's root.

A component that must render call-site markup with its own data uses a `<Snippet>` ([[DECISION-D166-SNIPPETS]]); a marker cannot pass data out.

## Alternatives rejected
- `this.$emit('event', data)` with inter-component bubbling — callback props make it unnecessary, and it brings back bus-like indirection ([[DECISION-D18-PER-NODE-LISTENERS]]).
