---
name: template parser entry
status: verified
path: parser/parser.go
language: go
summary: >-
  Recursive-descent template parser and grammar validation, including the D173 V1 formatter-chain
  rule (parseChain, isFormatterName, the condition-header / {#for} / {:when} pipe bans) and D167
  component-name validation.
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
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

Source binding for the template parser. Behavioral intent stays on the owning component card, COMPONENT-TEMPLATE-PARSER in the connected `puzzle` plan (`repo=puzzle`); this card anchors that contract to `packages/puzzle-lang/parser/parser.go` (the Puzzle language module, D172; `path` is relative to this plan root, `packages/puzzle-lang`).

Where the 0.8.0 rules live in this file:

- `parseChain` is the one pipe rule for every value position that takes a chain: text interpolation, attribute values, component props and marker arguments (D173 V1). Only a top-level single `|` splits. The actual splitting is `scan.go`'s top-level splitter.
- `isFormatterName` requires each link after a pipe to be a name (`[A-Za-z_$][A-Za-z0-9_$-]*`, bare or called). Otherwise it reports the positioned "wrap a bitwise OR in parentheses" error.
- `hasTopLevelPipe` detects a pipe by `parseChain`'s rule for the header bans. `conditionPipeError` is the condition-header ban: the `{#if}`, `{:else if}`, `{#unless}` and `{#case}` headers here, and an inline `{#if}` inside an attribute value in `attr.go` — "formatter pipes are not allowed in <header> — compute the value in data() and test that field (e.g. …); for a logical OR, write ||". `forPipeError` is the `{#for}` header ban (the collection or either range bound), and the `{:when}` ban is inline in the case-clause parser. All are positioned errors that name the fix, and none falls back to a bitwise OR. So `If`, `Case` and `InlineIfPart` carry no formatter chain.
- Capitalized tag names are validated as `Ident('.'Ident)*` (D167).
