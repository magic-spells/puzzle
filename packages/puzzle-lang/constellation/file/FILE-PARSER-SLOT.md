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
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: verified
    text: >-
      0.8.0 release-prep sweep. Each bound file was diffed against the b1a8642a baseline. scan.go is
      byte-identical, since only the path moved into puzzle-lang. sections.go changed only its
      textutil import path and one comment. parser.go gained the D173 V1 chain rule (parseChain,
      isFormatterName, the {#for}/{:when} pipe bans) and the D167 name check. slot.go gained D166
      snippet markers and the D173 V13 per-path pass. The bodies now say so. The test count is 12
      files. `go vet` and `go test ./...` pass in packages/puzzle-lang.
    sha: a602784a9822fa3ff63123e597f72624b3c9ffff
---

# slot.go

Source binding for DECISION-D71-SLOT-FORWARDING, DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS, DECISION-D166-SNIPPETS and DECISION-D173-CORE-SEMANTICS (V13), all in the connected `puzzle` plan (`repo=puzzle`). The path is the contract; keep behavioral detail on the owning cards. The file lives at `packages/puzzle-lang/parser/slot.go` (the Puzzle language module, D172); `path` is relative to this plan root, `packages/puzzle-lang`.

What the file owns:

- **Marker attribute shapes.** `childrenMarkerAttrs`, `slotMarkerFromAttrs` (unnamed outlet or default marker vs a static named slot; `default`/`children` steer to `<Children/>`), `portalMarkerAttrs` (v1 takes none), and `snippetMarkerAttrs` (`fits` plus bare parameter declarations).
- **Per-render-path uniqueness (D173 V13).** `validateSlots` → `walkSlots` → `walkBranches`. Each exclusive branch of an `{#if}`/`{:else}`/`{:else if}`/`{#unless}`/`{#case}` is walked against its own copy of the markers already on the path. Then everything a branch declared merges back, so a marker after the block still collides. Two default markers in exclusive branches are legal. Two on one path, in one loop body, or in two separate `{#if}`s are an error.
- **Call-site `slot=` rules** on a component invocation's direct children: a dynamic `slot={expr}` is an error, and so is a control-flow block whose top-level nodes carry `slot`.
