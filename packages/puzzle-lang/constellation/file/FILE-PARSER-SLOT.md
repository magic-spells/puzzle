---
name: slot.go
status: verified
path: parser/slot.go
language: Go
summary: >-
  Composition-marker validation: <Children>/<Slot>/<Portal>/<Snippet> attribute shapes, call-site
  slot rules, and the D173 V13 per-render-path marker uniqueness pass
  (validateSlots/walkSlots/walkBranches).
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
---

# slot.go

Composition-marker validation. Behavioral contract: DOC-SPEC-TEMPLATE §24/§64,
DECISION-D71-SLOT-FORWARDING, DECISION-D166-SNIPPETS and
DECISION-D173-CORE-SEMANTICS (V13), all in the framework plan (`repo=puzzle`).

- **Marker attribute shapes.** `childrenMarkerAttrs`, `slotMarkerFromAttrs`
  (unnamed outlet/default marker vs a static named slot; `default`/`children`
  steer to `<Children/>`), `portalMarkerAttrs` (takes none), and
  `snippetMarkerAttrs` (`fits` plus bare parameter declarations).
- **Per-render-path uniqueness (V13).** `validateSlots` → `walkSlots` →
  `walkBranches`. Each exclusive branch of an `{#if}`/`{:else if}`/`{:else}`/
  `{#unless}`/`{#case}` is walked against its own copy of the markers already on
  the path; then everything a branch declared merges back, so a marker after the
  block still collides. Two default markers in exclusive branches are legal; two
  on one path, in one loop body, or in two separate `{#if}`s are an error.
- **Call-site `slot=` rules** on a component invocation's direct children: a
  dynamic `slot={expr}` is an error, and so is a control-flow block whose
  top-level nodes carry `slot`.
