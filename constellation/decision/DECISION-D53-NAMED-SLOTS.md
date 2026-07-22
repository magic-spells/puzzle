---
name: "D53 — Named slots: <slot name> with fallbacks, filled by slot=\"…\" attributes on direct component children (v1.21)"
status: verified
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D44-DOM-ISLANDS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - FEATURE-NAMED-SLOTS
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
verified_at: '2026-07-12T00:15:03.604Z'
notes:
  - kind: verified
    text: >-
      Decision implemented as written and verified at the merged main sha (480 vitest + all Go
      green); bare-slot goldens byte-identical as required; no deviations from the recorded
      contract.
  - kind: state
    text: >-
      Amended by D74 (v1.41): the bare default `<slot/>` spelling this card froze is retired — the
      default marker is now spelled `<children/>` (components) / `<Slot/>` (router outlet), and
      lowercase `<slot>` requires `name` (with `name="children"` newly reserved alongside
      "default"). D74 also un-freezes this card's deferred "fallback content on the default slot":
      `<children>` may carry fallback children with the same semantics named slots always had. All
      D53 mechanics (partition/expand, call-site `slot=` attr rules, one marker type) hold
      unchanged; emission is byte-stable. See DECISION-D74-CHILDREN-MARKER.
---

# D53 — Named slots: `<slot name>` with fallbacks, filled by `slot="…"` attributes on direct component children (v1.21)

Completes the [[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]] composition story.
Multi-region components (card header/footer, modal title/body/actions) declare
`<slot name="header">fallback</slot>`; call sites target regions with the HTML
`slot` attribute on direct children. See [[DOC-SPEC]] §24.

## Context
D16 shipped the default `<slot/>` only; multi-insertion-point components needed
callback props or wrapper gymnastics. Open questions: the parent-side targeting
syntax (must fit the grammar + single-root rules) and whether view slots (D30
`<Slot/>`) and component slots stay unified.

## Decision
- **Parent side: the HTML `slot` attribute, on direct children of a component
  tag.** `<Card><h2 slot="header">Hi</h2><p>body</p></Card>` — a **static**
  `slot="name"` on a direct child (element or component tag) routes that node to
  the named region; direct children without one form the default slot content,
  exactly as today. This is Web Components semantics, spelled with zero new
  grammar — the same shipping pattern as `island` (D44): a plain static attribute
  with compile rules. The attribute is compile-time routing metadata and is
  **stripped** from the rendered element. (Rejected: `<template slot="x">`
  wrappers — a new pseudo-tag with un-renderable semantics; `{#slot x}` blocks —
  control-flow syntax for something that isn't control flow; a `<Fill>` component
  — magic tag namespace.)
- **Compile errors at the call site:** dynamic `slot={expr}` on a direct
  component child; a control-flow block at direct-child level that contains
  top-level `slot`-attributed elements (silent default-routing would misroute —
  the fix is putting the condition *inside* the slotted element). Anywhere other
  than a direct component child, `slot` is NOT ours: it passes through as the
  ordinary HTML global attribute (shadow-DOM users inside islands keep it).
- **Child side: `<slot name="header">…fallback…</slot>`** (or self-closing when
  no fallback). Fallback bodies use the full template grammar and render when the
  call site supplies nothing for that name. `name` must be a static, non-empty,
  per-template-unique string; `name="default"` is reserved (compile error — the
  bare `<slot/>` IS the default). The default `<slot/>`/`<Slot/>` stays
  **byte-for-byte unchanged**: self-closing, no fallback, one per template as
  today's rules dictate.
- **Runtime: partition once, expand per marker.** The ViewManager partitions
  captured call-site children into named buckets + default by the (stripped)
  `slot` attr; `expandSlots` substitutes a named marker with its bucket **or its
  fallback children** when the bucket is empty, and the default marker with the
  default bucket exactly as before. Slot-attribute-free templates take the
  existing code path untouched.
- **View slots and component slots stay mechanically unified, semantically
  distinct:** one marker type, one expansion pass — but the router (D30 chains)
  only ever fills the DEFAULT slot; a named slot in a view/layout template just
  renders its fallback. No router change.
- **Codegen:** the `Slot` node gains name + fallback children and emits
  `new ViewNode(SLOT_TAG, { name }, fallback)`; nameless slots emit today's bare
  marker so name-free templates (golden #1 included) are **byte-identical**.

## Alternatives rejected
- Scoped slots (child data flowing into parent-provided content) — explicitly out
  of scope per the backlog card; a separate, larger decision.
- Honoring `slot` attrs at any depth (true shadow-DOM flattening) — depth-crossing
  routing is spooky action; direct-child-only keeps the call site readable.
- Fallback content on the default `<slot/>` — the card froze default behavior;
  revisit only with the next composition decision.

## Consequences
Full-stack amendment: parser (Slot name/fallback + call-site rules), codegen
(marker emission), ViewManager (partition + fallback expansion). Golden files
for name-free templates unchanged; new goldens cover named forms. Layouts/nested
routes untouched.
