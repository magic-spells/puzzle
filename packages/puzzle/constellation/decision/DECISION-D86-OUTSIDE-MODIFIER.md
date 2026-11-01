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
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D86 — The `outside` event modifier: `@event:outside`

`@click:outside={ close }` (any event — `@pointerdown:outside`,
`@focusin:outside`) listens on `document` in the capture phase and runs the
handler only when the target is outside the bound element. The framework owns
cleanup. Spec: [[DOC-SPEC-TEMPLATE]] §5 and §47.

## Decision

`outside` is one entry in the D38 generic-modifier table, with these runtime
semantics:

- **Document, capture phase.** An unrelated `stopPropagation()` can't swallow
  the event, and the interaction that *opens* a panel can't instantly close it
  (the panel's listener attaches after document capture has passed). One shared
  `{ capture: true }` options object, so add and remove always match.
- **Logical containment:** `portalAwareContains(el, target)` (`views/portal.js`)
  — `el.contains` first; a target inside the portal outlet resolves to its
  owning portal's placeholder and re-tests (nested portals iterate), so content
  portaled by a descendant counts as inside (D144). Free with no live portals.
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
- Not gated by D89: it is inline branches, not a module.

## Gotchas

Events inside an `<iframe>` never reach the parent document. On touch,
`pointerdown` fires at scroll start, so prefer `@click:outside` for scroll
tolerance.

## Alternatives rejected

- **`use:clickOutside` element actions** — a directive namespace plus lifecycle
  for what one modifier covers.
- **Bubble-phase document listener** — defeated by `stopPropagation` and races
  the opening interaction.
- **Pointer events only** — kills `@focusin:outside`.
