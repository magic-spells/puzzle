---
name: v1.52 — @event:outside modifier (D86)
status: planned
connections:
  - DECISION-D86-OUTSIDE-MODIFIER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - DOC-EVENTS
  - FILE-VIEW-MANAGER
  - FILE-PARSER
---

# v1.52 — @event:outside modifier (D86)

`@event:outside={ handler }` — the listener attaches to `document` (capture
phase) and the handler runs only when the event target is outside the bound
element. Framework-owned cleanup on unmount. Ship
[[DECISION-D86-OUTSIDE-MODIFIER]].

## Scope

- In (compiler): `outside` joins the generic-modifier table
  (`eventGenericMods`, parser) — valid on any event, existing D38 validation
  (unknown/duplicate/component-prop rules) unchanged; a golden/parser test.
- In (runtime, `viewManager.js`): outside-flagged bindings attach/detach on
  `document` with capture through the existing `setAttr`/`removeAttr` `@`
  paths (LISTENERS bookkeeping unchanged — full-name keys); the wrapper's
  outside-gate (`el.contains(event.target)` bails) runs before key-gate/
  once/prevent/stop; `releaseSubtree` detaches outside-listeners for every
  removal shape (the D72 ref-null walk).
- Out (per D86): event-type restrictions, iframe reach, any SSG/grammar/
  tooling change (none needed).

## Acceptance

- Panel inside `{#if open}`: listener exists only while mounted; outside
  click fires handler, inside click never does; capture semantics beat a
  sibling's `stopPropagation`; the opening click does not self-dismiss;
  inline-null toggle adds/removes the document listener; unmount via
  conditional, keyed-row removal, subtree teardown, and full view destroy all
  detach (no document-listener leaks — assert via listener spies);
  `:outside:once` composes; `@focusin:outside` works; compile error surface
  unchanged elsewhere; full vitest + go suites green.
