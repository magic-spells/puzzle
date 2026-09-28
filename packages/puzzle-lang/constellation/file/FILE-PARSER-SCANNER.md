---
name: template expression scanner
status: verified
path: parser/scan.go
language: go
summary: Shared balanced JS-like scanner and top-level splitting helpers.
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
  - kind: state
    text: >-
      D176: `nestedPipeIndex(expr)` scans a value with LexSkip (strings, regex, comments opaque),
      tracks paren/bracket/brace depth, and returns the byte index of the first single `|` (not
      `||`, not `|=`) at depth > 0, or -1. The chain splitter still finds top-level pipes as before;
      this is the second pass that turns a nested one into an error instead of a bitwise OR.
---

Source binding for the template parser. Behavioral intent stays on the owning component card, COMPONENT-TEMPLATE-PARSER in the connected `puzzle` plan (`repo=puzzle`); this card anchors that contract to `packages/puzzle-lang/parser/scan.go` (the Puzzle language module, D172; `path` is relative to this plan root, `packages/puzzle-lang`).

Every balanced scan here routes through the one `LexSkip` helper (`lexskip.go`): `scanBraceGroup`, the top-level splitters (`splitTopLevel`, `lastTopLevelIndexByte`, `topLevelIndex`), and `matchingClose`, which returns the bracket closing a given `(`/`[`/`{` and is how `parseFormatter` finds where a formatter call's argument list ends.
