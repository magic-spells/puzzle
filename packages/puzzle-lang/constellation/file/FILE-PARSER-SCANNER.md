---
name: template expression scanner
status: verified
path: parser/scan.go
language: go
summary: Shared balanced JS-like scanner and top-level splitting helpers.
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the template parser. Behavioral intent stays on the owning component card, COMPONENT-TEMPLATE-PARSER in the connected `puzzle` plan (`repo=puzzle`); this card anchors that contract to `packages/puzzle-lang/parser/scan.go` (the Puzzle language module, D172; `path` is relative to this plan root, `packages/puzzle-lang`).
