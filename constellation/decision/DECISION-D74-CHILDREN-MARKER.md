---
name: 'D74 — <children/>: the default marker leaves the slot word (v1.41)'
status: verified
connections:
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D71-SLOT-FORWARDING
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - FILE-PARSER
  - FILE-COMPILER-INTERNAL-PARSER-SLOT
  - FILE-CODEGEN
  - FILE-VIEW-MANAGER
verified_at: '2026-07-22T01:03:40.412Z'
notes:
  - kind: verified
    text: >-
      Implemented and verified: parser
      role split (parser.go parseElement + slot.go's
      childrenMarkerAttrs/slotOutletAttrs/namedSlotFromAttrs), codegen default-with-fallback case,
      island rejection generalized. Byte-stability gate held — slot.golden.js/named_slots.golden.js
      unchanged after fixture respell; new children_fallback golden. 788 vitest + all Go packages
      green; every respelled example .pzl compile-checked via pzlc (12/12). Runtime/SSG/router
      zero-diff as designed. Implementation by two Opus subagents against this card's contract;
      reviewed + verified by the session orchestrator.
---

# D74 — `<children/>`: the default marker leaves the `slot` word (v1.41)

The lowercase bare `<slot/>` is retired. The default marker gets its own
spelling — `<children/>` — and each surviving spelling has exactly one role:

| Spelling | Role |
|---|---|
| `<children/>` | the default marker — call-site children land here; canonical in **components** |
| `<Slot/>` | the same marker, capitalized — canonical as the **router outlet** in routed views/layouts (D30) |
| `<slot name="x">fallback</slot>` | a **named** slot, and nothing else — `name` is now REQUIRED |
| `slot="x"` attr (call site) | routes a direct child to a named slot (D53, unchanged) |

A nameless `<slot>`/`<slot/>` anywhere is a positioned compile error naming
both replacements.

## Context

`slot` carried three roles: the default marker (D16), named insertion points
(D53), and the router outlet (`<Slot/>`, D30) — with D71 forwarding adding a
fourth *position* (bare `<slot/>` inside an invocation). The case-only
distinction between `<slot/>` and `<Slot/>` never held in practice: the
repo's own examples used lowercase bare `<slot/>` as the router outlet, and
the framework's author misread bare `<slot/>` in a component as needing a
`<Children/>` concept — direct evidence the overload confuses even its
owners. It also degrades LLM template generation, which the agent-friendliness
track (2026-07-19 session) cares about: a grammar where each token has one
meaning is what makes generated templates correct on the first try.

npm publish has not happened (0.1.0 pending), so this is the last moment the
change is a repo-internal sweep instead of a breaking migration.

## Decision

- **`<children/>` is the default marker.** No attributes — any attribute is a
  positioned compile error (`ref` gets the D72-style render-target message).
  It MAY carry fallback children (`<children><p>empty</p></children>`),
  rendered when the default bucket is empty — this un-freezes D53's deferred
  "fallback on the default slot" with the exact semantics named slots always
  had (the runtime's `expandChildList` fallback path is already generic; the
  capability costs nothing).
- **`<Slot/>` stays the router outlet, bare only.** A `name` attribute on the
  capitalized spelling is now a compile error steering to lowercase
  `<slot name>`; children remain rejected ("cannot have children" — the
  outlet keeps D53's frozen no-fallback posture; an index child route is the
  sanctioned empty-state). The compiler cannot enforce "views only" — a view
  and a component are the same `.pzl` format — so `<Slot/>`-in-views vs
  `<children/>`-in-components is a **documented convention over one
  mechanism**, not two mechanisms.
- **Lowercase `<slot>` requires `name`.** Bare → positioned error:
  use `<children/>` for call-site children, `<Slot/>` for the router outlet.
  `name="default"` stays reserved; **`name="children"` is newly reserved**
  (error steers to `<children/>`).
- **One default marker per body**, counting every spelling (`<children/>` and
  `<Slot/>` both key the same uniqueness bucket — two would splice the same
  vnodes twice, D53's rule unchanged).
- **D71 forwarding respelled, not changed:** `<Card><children/></Card>`
  forwards the enclosing template's default content through Card (`<Slot/>`
  works identically in that position — same node). Named markers inside an
  invocation remain compile errors.
- **Emission is byte-stable.** All spellings compile to the same marker vnode:
  bare → `new ViewNode(SLOT_TAG)` exactly as before; `<children>` with
  fallback → `new ViewNode(SLOT_TAG, {}, [ …fallback ])` (the one new codegen
  case); named unchanged. Templates already spelled `<Slot/>`/`<slot name>`
  compile **byte-identically**. The runtime kernel, ViewManager expansion,
  SSG serializer, and router are **untouched** — `expandChildList` already
  substitutes the default bucket for a nameless marker and falls back to the
  marker's own children when the bucket is empty.

## Alternatives rejected

- **Reserve `name="children"` and spell the default `<slot name="children">`**
  — verbose, and keeps every role on one word; the overload survives.
- **Keep bare `<slot/>` legal alongside `<children/>`** — two live spellings
  for the same thing makes the confusion worse, not better. The positioned
  error with did-you-mean IS the migration path, and pre-publish there is no
  external code to break.
- **Enforce `<Slot/>` in views / `<children/>` in components** — impossible at
  compile time (same file format; view-ness is a routes.js concern).
- **`<Children/>` capitalized** — a capitalized tag means an imported
  component class everywhere else in the grammar; `<children>` follows the
  `<slot>`/HTML-vocabulary precedent (and can never collide with a custom
  element, which requires a hyphen).

## Consequences

Parser + codegen amendment; sweep of examples/scaffold/docs; runtime and SSG
zero-diff. Goldens for `<Slot/>`/named templates unchanged; respelled fixture
sources must produce byte-identical output (the verification gate). New
goldens cover `<children>` fallback. tests/fixtures/slot-forwarding sources
respelled and their compiled fixtures regenerated. SPEC §24 amended in place
(v1.41); D53/D71 cards annotated, not rewritten — their mechanics all hold.
