---
name: Composition markers, snippets, slots, and Portal
kind: unit
status: verified
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
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Composition markers, snippets, slots, and Portal

Proves the composition surface ([[DOC-SPEC-TEMPLATE]] §24, §64, §67): `<Children>` as the
default marker, `<Slot name="x">` as a named slot, `<Slot>` as the router outlet,
`<Snippet>` as caller-owned stamped content, `<Portal>` as the out-of-tree escape, and
`<Component>` selection. Run with
`npx vitest run tests/composition tests/named-slots tests/slot- tests/marker-fallbacks tests/lazy-slot-fallback tests/snippet tests/portal tests/conditional-router-slot tests/component-slot`.

- `composition`: inline component rendering, prop reactivity, teardown on child removal,
  keyed component lists, the pre-first-commit slot-update guard.
- `named-slots`: named slots through routing, slotted components crossing control flow,
  reserved-name buckets, keyed reconciliation inside a slotted region.
- `slot-forwarding` / `slot-forwarding-compiled`: default-slot forwarding through an
  intermediate component, the router, and the SSG serializer, in two lanes (handwritten
  fixture and a layout compiled by the real compiler) so the marker contract is proven
  against actual emission. `slot-filled` pins the slot-filled rule.
- `marker-fallbacks` / `lazy-slot-fallback`: a fallback body renders only while nothing
  fills the position. A filled marker never evaluates its fallback, in the browser or in
  prerendered output; an unfilled fallback is built once per marker and a clean cached row
  keeps its fallback vnodes and DOM (fixtures shaped like the VirtualList piece's row).
- `snippets` / `snippets-compiled` / `snippet-tag-escape`: marker/ref exclusions inside a
  body, marker-site uniqueness, per-stamp args and fresh vnodes, caller and component
  refreshes, diagnostics, serialization, warning-free hybrid/static takeover.
- `portal`: mounting into the framework outlet, teardown, and the `outside` modifier.
- `conditional-router-slot`: hide/show of an outlet through direct, element and component
  wrappers; hidden navigation, reused nested chains, initially absent outlets, single
  mounts, complete teardown. The animated-wrapper case is not covered (see
  [[STATE-VIEW-LIFECYCLE]]).
- `component-slot` (D180): children fill the selected component's default slot; an empty
  selection leaves an enclosing default marker unfilled; named-slot routing metadata is
  consumed by the selection, while an unconsumed ordinary `slot` prop still forwards.
  The same suite's DOM, lifecycle and serializer halves are listed in
  [[TEST-DOM-PATCHING]], [[TEST-RUNTIME-LIFECYCLE]] and [[TEST-PRERENDER-OUTPUT]].

Gotcha: the compiled lanes read fixtures `npm run pretest` generates
(`build:slot-forwarding`, `build:snippets`, `build:lazy-fallback`,
`build:component-slot`); a bare `npx vitest run` on a fresh clone fails them until
pretest has run once.
