---
name: codegen lexical helpers
status: verified
path: compiler/internal/codegen/expr.go
language: go
summary: >-
  Small lexical helpers the emitters share: JS identifier tests for unquoted keys, the
  leading-object-literal compile error, and the Unicode identifier-run helpers the <script> scans
  extend LexSkip with. Expressions themselves are lowered in lower.go.
connections:
  - COMPONENT-CODEGEN
  - FILE-CODEGEN-LOWER
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

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `compiler/internal/codegen/expr.go`.

The file is small: `isJSIdentifier` (whether an attribute or prop name can be an unquoted object key — ASCII only, so `jsKey` quotes a non-ASCII prop name: `<Card größe={ 3 }>` emits the key `'größe'`) and `startsWithObjectLiteral` with its positioned error for an expression whose braces open with an object literal (`{ { a: 1 } }`, D173 V8 — pass it as a function argument or build it in `data()`). It also holds the two helpers that make the `<script>` scans read Unicode names ([[COMPONENT-CODEGEN]], D176 rule 8): `identRunEnd` continues an identifier run past the ASCII part `parser.LexSkip` consumed, through every non-ASCII rune `jsident.IsIDContinue` accepts, and `startsNonASCIIIdent` reports a run that opens with a non-ASCII `jsident.IsIDStart` rune. `tokenizeJS` and the `__d.` collision scan (scriptcollide.go) call both, so `Straßenkarte` and `金額` are one name. Template expressions are lowered from their AST in `lower.go` ([[FILE-CODEGEN-LOWER]]), which resolves every name from the tree.
