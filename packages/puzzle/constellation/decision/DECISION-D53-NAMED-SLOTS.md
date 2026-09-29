---
name: 'D53 — Named slots: call-site `slot="…"` on direct component children, partitioned at runtime'
status: verified
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D141-MARKER-FALLBACK-BODIES
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
verified_at: '2026-07-12T00:15:03.604Z'
code_refs:
  - client-runtime/views/viewManager.js
---

# D53 — Named slots: call-site `slot="…"`, runtime partition

Multi-region components (card header/footer, modal title/body/actions) declare `<Slot name="header"/>`; call sites route content to it with the HTML `slot` attribute. Marker spelling and the child-side name rules are [[DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS]]; fallback bodies are [[DECISION-D141-MARKER-FALLBACK-BODIES]]. See [[DOC-SPEC-TEMPLATE]] §24.

## Decision

- **Call site: a static `slot="name"` on a direct child** (element or component tag) of a component tag routes that node to the named region: `<Card><h2 slot="header">Hi</h2><p>body</p></Card>`. Direct children without one form the default content (rendered at `<Children/>`). Web Components semantics with no new grammar. The attribute is routing metadata, **stripped** from the rendered element.
- **Call-site compile errors:** a dynamic `slot={expr}` on a direct component child; a control-flow block at direct-child level that contains top-level `slot`-attributed elements (default-routing would silently misroute — put the condition inside the slotted element).
- **Anywhere else, `slot` is not ours** — it passes through as the ordinary HTML attribute (shadow-DOM users inside islands keep it).
- **Runtime: partition once, expand per marker.** The ViewManager partitions captured call-site children into named buckets plus the default bucket by the stripped `slot` attribute; slot expansion substitutes each named marker with its bucket (or its fallback when empty) and the default marker with the default bucket. Slot-free templates take the plain path.
- **One marker mechanism, two fillers.** The router ([[DECISION-D30-NESTED-ROUTES]]) fills only the bare `<Slot/>` outlet; a named slot in a view or layout renders its fallback.
- Codegen emits a named marker as `new ViewNode(SLOT_TAG, { name: 'header' })`; a fallback body rides as a `fallback: () => [ … ]` thunk attribute (D141).

## Alternatives rejected
- `<template slot="x">` wrappers, `{#slot x}` blocks, or a `<Fill>` component — a pseudo-tag, control-flow syntax for non-control-flow, or a magic tag namespace.
- Honoring `slot` at any depth (shadow-DOM flattening) — depth-crossing routing is spooky action; direct-child-only keeps the call site readable.
- Scoped slots — covered by snippets ([[DECISION-D166-SNIPPETS]]).
