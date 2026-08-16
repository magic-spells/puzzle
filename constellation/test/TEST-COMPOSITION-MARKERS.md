---
name: Composition markers, slots, and Portal
kind: unit
status: built
framework: vitest
connections:
  - COMPONENT-VIEW-MANAGER
  - FILE-PORTAL
  - FILE-COMPILER-INTERNAL-PARSER-SLOT
  - FILE-TESTS-SLOT-FORWARDING-TEST
  - FILE-TESTS-SLOT-FORWARDING-COMPILED-TEST
  - DECISION-D16-COMPOSITION-SLOTS-CALLBACKS
  - DECISION-D53-NAMED-SLOTS
  - DECISION-D71-SLOT-FORWARDING
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - DECISION-D141-MARKER-FALLBACK-BODIES
  - DECISION-D144-PORTAL
  - FEATURE-NAMED-SLOTS
  - DOC-TESTING
---

# Composition markers, slots, and Portal

Proves the composition surface that the public invariants ride on: `<Children>`
as the component default marker, `<Slot name="x">` as named composition,
`<Slot>` as the router outlet, and `<Portal>` as the out-of-tree escape.

Guarantees:

- inline component rendering, prop reactivity, teardown on child removal, and
  keyed component lists.
- the pre-first-commit slot-update guard.
- named slots through routing, slotted components crossing control flow,
  reserved-name slot buckets, and keyed reconciliation inside a slotted region.
- default-slot forwarding through an intermediate component, end to end through
  the router, and through the SSG serializer.
- marker fallback bodies: a paired marker's body renders only while nothing
  fills the position, and disappears the moment something does.
- Portal mounting into the framework outlet, teardown, and its interaction with
  the outside-click modifier.

Slot forwarding runs in two lanes — a handwritten fixture and a layout compiled
by the real compiler — so the marker contract is proven against actual emission,
not just against a hand-shaped vnode tree.

Covers 6 files under `tests/`.
