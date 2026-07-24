---
name: 'D86 — the `outside` event modifier: `@event:outside` declarative outside-dismiss (v1.52)'
status: verified
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - DOC-EVENTS
  - DECISION-D38-EVENT-MODIFIERS
  - DECISION-D72-ELEMENT-REFS
  - FILE-VIEW-MANAGER
  - FILE-PARSER
  - FEATURE-V1-52-OUTSIDE-MODIFIER
verified_at: '2026-07-24T00:26:45.343Z'
verified_sha: df909f7f5581b312acbbc45a58cbd2b5e681a2a8
---

# D86 — the `outside` event modifier: `@event:outside` declarative outside-dismiss (v1.52)

A new generic event modifier: `@click:outside={ close }` (any event —
`@pointerdown:outside`, `@focusin:outside`) attaches the listener to
`document` in the **capture phase** and runs the handler only when the event
target is **outside** the bound element (`el.contains(event.target)` bails).
The framework owns the document-listener cleanup on unmount. Cory's design;
see [[DOC-SPEC]] §5 (modifier table) and §47.

## Context

Outside-dismiss is the single dominant "element action" use case — the reason
Svelte apps write `clickOutside` as their first action. Puzzle's own pieces
prove the demand: sixteen registry pieces (Popover, DatePicker, Select,
DropdownMenu, Combobox, …) hand-roll the identical pattern — a document
`pointerdown` listener added on open, an `element.contains(e.target)` guard,
and **32** `removeEventListener` sites between them, each a leak waiting for a
missed teardown path. D-review (2026-07) had deferred `use:` actions partly on
the bet that a narrower primitive would cover this case; this is that
primitive. The modifier machinery already exists at every layer: the parser's
generic-modifier table (D38) and the runtime's per-listener bookkeeping +
`withModifiers` wrapper — so the surface parses today with zero grammar or
editor-tooling ripple.

## Decision

**One new entry in the generic-modifier table, with three deliberate runtime
semantics:**

- **Document + capture phase.** The listener lives on `document`, capture. Two
  hand-rolled-pattern bugs die by construction: an unrelated component's
  `stopPropagation()` cannot swallow the outside event (bubble listeners on
  `document` never hear it; capture always does), and the interaction that
  OPENS a panel cannot instantly close it — a panel rendered synchronously
  mid-event attaches its listener after document's capture phase already
  passed. (The Popover piece carries a comment block working around exactly
  this race.)
- **Containment via `el.contains(event.target)`**, the element being the one
  carrying the binding — inside events bail before every other modifier step.
  Canonical order becomes: outside-gate → key-gate → once-spend →
  `preventDefault` → `stopPropagation` → handler; a bailed event spends
  nothing.
- **Framework-owned cleanup.** A document listener does not die with its
  element, so the removed-subtree walk (`releaseSubtree` — the same walk that
  nulls D72 refs on every removal shape) detaches outside-listeners. The
  patch-time swap and the inline-null toggle
  (`@pointerdown:outside={ open ? close : null }`) route through the existing
  `setAttr`/`removeAttr` paths, which target `document` for outside-flagged
  names. The LISTENERS bookkeeping keys by full attr name, so `@click` and
  `@click:outside` on one element never collide.
- **Event-generic**, like `prevent`/`stop`/`once`. `@pointerdown:outside`
  dismisses on press; `@focusin:outside` is focus-left-the-widget detection —
  the other pattern dropdown widgets hand-roll. No allowed-event restriction:
  the containment check is event-agnostic, and restricting would grow the
  compile-error matrix for no failure mode. Existing D38 rules stand
  unchanged: unknown modifier, duplicates, and any modifier on a component
  callback prop remain compile errors.

Known limitations, documented not solved: events inside an `<iframe>` never
reach the parent document (true of every outside-click implementation), and on
touch, `pointerdown` fires at scroll-start — apps preferring scroll-tolerance
use `@click:outside`. The event choice stays with the author by construction.

## Consequences

- Popovers/dropdowns/dialogs collapse to one attribute on the panel (inside
  `{#if open}` the listener's lifetime tracks the panel automatically) or the
  root-with-null-toggle form; the leak-on-forgotten-cleanup footgun is retired
  framework-wide.
- The pieces registry can migrate its sixteen hand-rolled implementations —
  AFTER 0.2.0 ships, since an unknown modifier is a compile error on older
  compilers (migrated pieces require puzzle ≥ 0.2.0).
- ~0.2–0.3 KiB gzip; no SSG change (`@`-attrs already stripped), no editor
  grammar or lint/format plugin change (modifiers parse generically).
- Further weakens the case for `use:` element actions (the §Deferred entry).

## Alternatives rejected

- `use:clickOutside` element actions — a directive namespace + runtime
  lifecycle + instance-field boilerplate for what one modifier row covers
  (the D-review deferral, now reinforced).
- Bubble-phase document listener — defeated by unrelated `stopPropagation`
  and races the opening interaction (both observed in the pieces).
- `event.target.closest()` containment — selector matching where a direct
  `contains` walk answers the same question cheaper.
- Restricting `outside` to pointer events — kills `@focusin:outside` and adds
  compile-error surface with no corresponding failure mode.
