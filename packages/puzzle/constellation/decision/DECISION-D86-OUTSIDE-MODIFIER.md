---
name: 'D86 — The outside event modifier: @event:outside declarative outside-dismiss'
status: verified
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-EVENTS
  - DECISION-D38-EVENT-MODIFIERS
  - DECISION-D72-ELEMENT-REFS
  - FILE-VIEW-MANAGER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D86 — The `outside` event modifier: `@event:outside`

`@click:outside={ close }` (any event — `@pointerdown:outside`,
`@focusin:outside`) listens on `document` in the capture phase and runs the
handler only when the target is outside the bound element. The framework owns
cleanup. Spec: [[DOC-SPEC-TEMPLATE]] §5 and §47.

## Decision

One entry in the D38 generic-modifier table, with these runtime semantics:

- **Document + capture phase.** An unrelated `stopPropagation()` can't swallow
  the event, and the interaction that *opens* a panel can't instantly close it
  (the panel's listener attaches after document capture has passed).
- **Logical containment:** `portalAwareContains(el, target)` — `el.contains`
  first; a target inside the portal outlet resolves to its owning portal's
  placeholder and re-tests (iterating for nested portals), so content portaled by
  a descendant counts as inside (D144). Zero cost with no live portals.
- **Modifier order:** outside-gate → key-gate → once-spend → `preventDefault` →
  `stopPropagation` → handler; a bailed event spends nothing.
- **Framework-owned cleanup:** `releaseSubtree` (the walk that nulls D72 refs)
  detaches outside listeners on every removal shape; patch-time swaps and the
  inline-null toggle (`@pointerdown:outside={ open ? close : null }`) go through
  `setAttr`/`removeAttr`, which target `document` for outside-flagged names.
  Listener bookkeeping keys by full attr name, so `@click` and `@click:outside`
  on one element don't collide.
- **Event-generic**, no allowed-event list. D38 rules stand: unknown or
  duplicate modifiers, and any modifier on a component callback prop, are
  compile errors.

Limitations (documented): events inside an `<iframe>` never reach the parent
document; on touch `pointerdown` fires at scroll start, so prefer
`@click:outside` for scroll tolerance.

## Alternatives

- **`use:clickOutside` element actions** — rejected: a directive namespace plus
  lifecycle for what one modifier covers.
- **Bubble-phase document listener** — rejected: defeated by `stopPropagation`
  and races the opening interaction.
- **`closest()` containment** — rejected: `contains` answers it cheaper.
- **Pointer events only** — rejected: kills `@focusin:outside`.
