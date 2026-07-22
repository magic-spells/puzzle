---
name: "v1.21 — Named slots"
status: verified
connections:
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D30-NESTED-ROUTES
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
verified_at: '2026-07-12T00:14:51.270Z'
notes:
  - kind: verified
    text: >-
      Verified at the merged main sha: parser validation, codegen emission (bare-slot byte-identity
      — pre-existing goldens unchanged), and ViewManager partition/fallback expansion reviewed
      against SPEC §24 at ship; tests/named-slots.test.js (7) + ~14 Go subtests + full suite green
      at this sha (480 vitest + all Go).
---

# v1.21 — Named slots

Multi-region composition, completing the [[DECISION-D16-COMPOSITION-SLOTS-CALLBACKS]]
story. Driven by [[DECISION-D53-NAMED-SLOTS]]; contract in [[DOC-SPEC]] §24.

## Intent

A parent fills named regions of a child's template (card header/footer, modal
title/body/actions) without callback props or wrapper gymnastics.

## Scope

**In (shipped):**
- Child side: `<slot name="x">…fallback…</slot>` (self-closing when no
  fallback; full grammar in fallbacks). Static/non-empty/per-body-unique name;
  `name="default"` reserved; bare `<slot/>`/`<Slot/>` byte-for-byte unchanged.
- Call-site side: static `slot="x"` on **direct children** of a component tag
  routes them (attribute stripped from rendered output); unattributed children
  form the default content. Compile errors: dynamic `slot={expr}`; control-flow
  blocks at direct-child level with top-level slotted elements. Elsewhere,
  `slot` passes through as the HTML global attribute.
- Runtime: `partitionSlots` splits captured content once per render (cloning
  slotted nodes minus the attr, originals never mutated); `expandNode`
  substitutes named buckets or fallbacks; slot-attr-free call sites take the
  pre-D53 fast path with zero clones. Router fills default only — named slots
  in views/layouts render fallbacks.

**Out (deferred in D53):** scoped slots; depth-crossing slot routing; fallback
content on the default slot.

## Outcome

Shipped in v1.21. Parser (Slot Name/Children + slot.go validation), codegen
(named marker emission; bare emission byte-identical — all pre-existing goldens
unchanged), viewManager (partition + fallback expansion);
`tests/named-slots.test.js` (7 tests) + ~14 new Go subtests + one new golden
pair. Full suite green: 472 vitest + all Go packages.
