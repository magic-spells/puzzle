---
name: slot.go
status: verified
path: parser/slot.go
language: Go
summary: >-
  Composition-marker validation: <Children>/<Outlet>/<Slot>/<Portal>/<Snippet> attribute shapes, call-site
  slot rules, and the D173 V13 per-render-path marker uniqueness pass
  (validateSlots/walkSlots/walkBranches).
verified_at: '2026-11-24T18:13:22.097Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
connections:
  - FILE-PARSER-COMPONENT
  - TEST-COMPILER-PARSER
---

# slot.go

Composition-marker validation. Behavioral contract: DOC-SPEC-TEMPLATE §24/§64,
DECISION-D71-SLOT-FORWARDING, DECISION-D166-SNIPPETS,
DECISION-D173-CORE-SEMANTICS (V13) and DECISION-D199-UPGRADE-PASS, all in the
framework plan (`repo=puzzle`).
A host can skip the whole pass with `Options.SkipSlotCheck` ([[FILE-PARSER-HOST]]).

- **Three default-bucket spellings.** `parseElement` (parser.go) builds one
  `Slot` node for `<Children>`, `<Outlet>` and `<Slot>`, with `Marker` holding
  the tag written. `<Children>` and `<Outlet>` fill the same default bucket and
  emit the same code; the spelling says who fills it (the call site or the
  router).
- **Marker attribute shapes.** `childrenMarkerAttrs`, `outletMarkerAttrs` (takes
  none; `ref` and `name` get their own messages), `slotMarkerFromAttrs` (one
  static name declares a named slot; `default`/`children` steer to
  `<Children/>`; no name returns an empty name), `portalMarkerAttrs` (takes
  none), and `snippetMarkerAttrs` (`fits` plus bare parameter declarations).
- **A `<Slot>` with no name** parses, and `walkSlots` rejects it with
  `bareSlotNote`: a layout or view uses `<Outlet/>`, a component `<Children/>`.
  The check sits in the slot pass so a host with its own slot rules can skip it.
- **Per-render-path uniqueness (V13).** `validateSlots` → `walkSlots` →
  `walkBranches`. Each exclusive branch of an `{#if}`/`{:else if}`/`{:else}`/
  `{#unless}`/`{#case}` is walked against its own copy of the markers already on
  the path; then everything a branch declared merges back, so a marker after the
  block still collides. Two default markers in exclusive branches are legal; two
  on one path, in one loop body, or in two separate `{#if}`s are an error.
  `<Children/>` and `<Outlet/>` count as the same default marker.
- **Call-site `slot=` rules** on a component invocation's direct children: a
  dynamic `slot={expr}` is an error, and so is a control-flow block whose
  top-level nodes carry `slot`. `<Component is={…}>` children follow the same
  rules as any component's ([[FILE-PARSER-COMPONENT]]).
