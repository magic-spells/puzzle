---
name: v1.52 — @event:outside modifier (D86)
status: verified
connections:
  - DECISION-D86-OUTSIDE-MODIFIER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - DOC-EVENTS
  - FILE-VIEW-MANAGER
  - FILE-PARSER
verified_at: '2026-08-23T19:55:36.751Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
notes:
  - kind: verified
    text: >-
      Merged (PR #16) and verified: +12 tests with listener-spy accounting; real-Chrome check —
      panel survives its own opening interaction (capture race), inside pointerdown/click never
      dismisses, outside pointerdown closes; golden pins '@click' + '@click:outside' coexisting.
    sha: 0858d1e52af13ecfe031278ca8e1db496ca3ff2c
release: RELEASE-V0-2-0
change: feature
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
  outside-gate (a logically-contained target bails —
  `portalAwareContains`, which is plain `el.contains` when no portal is live
  or Portal is compiled out) runs before key-gate/once/prevent/stop;
  `releaseSubtree` detaches outside-listeners for every removal shape (the
  D72 ref-null walk).
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
