---
name: Composition markers, snippets, slots, and Portal
kind: unit
status: built
framework: vitest
connections:
  - COMPONENT-VIEW-MANAGER
  - FILE-PORTAL
  - FILE-TESTS-SLOT-FORWARDING-TEST
  - FILE-TESTS-SLOT-FORWARDING-COMPILED-TEST
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D71-SLOT-FORWARDING
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D141-MARKER-FALLBACK-BODIES
  - DECISION-D144-PORTAL
  - DECISION-D166-SNIPPETS
  - DOC-SPEC-TEMPLATE
  - DOC-TESTING
---

# Composition markers, snippets, slots, and Portal

Proves the composition surface ([[DOC-SPEC-TEMPLATE]] §24, §64): `<Children>` as
the default marker, `<Slot name="x">` as a named slot, `<Slot>` as the router
outlet, `<Snippet>` as caller-owned stamped content, and `<Portal>` as the
out-of-tree escape. Suites: `composition`, `named-slots`, `slot-forwarding`
(+`-compiled`), `slot-filled`, `marker-fallbacks`, `lazy-slot-fallback`,
`snippets` (+`-compiled`), `snippet-tag-escape` and `portal` under `tests/`;
compiled fixtures come from `npm run pretest`.

- inline component rendering, prop reactivity, teardown on child removal, keyed
  component lists, and the pre-first-commit slot-update guard.
- named slots through routing, slotted components crossing control flow,
  reserved-name buckets, and keyed reconciliation inside a slotted region.
- default-slot forwarding through an intermediate component, through the
  router, and through the SSG serializer — in two lanes, a handwritten fixture
  and a layout compiled by the real compiler, so the marker contract is proven
  against actual emission.
- fallback bodies render only while nothing fills the position. Lazy fallbacks
  (fixtures shaped like the VirtualList piece's row): a filled marker never
  evaluates its fallback, in the browser or in prerendered output; an unfilled
  fallback is built once per marker and a clean cached row keeps its fallback
  vnodes and DOM.
- snippets: marker/ref body exclusions, marker-site uniqueness, per-stamp
  args and fresh vnodes, variable-length output, caller/component refreshes,
  diagnostics, serialization, and warning-free hybrid/static takeover.
- Portal mounting into the framework outlet, teardown, and its interaction with
  the `outside` modifier.
