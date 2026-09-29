---
name: codegen lexical helpers
status: verified
path: compiler/internal/codegen/expr.go
language: go
summary: >-
  Small lexical helpers the emitters share: JS identifier tests for unquoted keys and the
  leading-object-literal compile error. Expressions themselves are lowered in lower.go.
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

The file is small: `isJSIdentifier` (whether an attribute or prop name can be an unquoted object key) and `startsWithObjectLiteral` with its positioned error for an expression whose braces open with an object literal (`{ { a: 1 } }`, D173 V8 — pass it as a function argument or build it in `data()`). Template expressions are lowered from their AST in `lower.go` ([[FILE-CODEGEN-LOWER]]), which resolves every name from the tree.
