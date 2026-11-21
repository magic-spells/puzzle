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
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# expr.go

Small lexical helpers the emitters share; template expressions themselves are
lowered from their AST in [[FILE-CODEGEN-LOWER]].

- `isJSIdentifier` is ASCII-only on purpose: it decides whether a prop name can be
  an unquoted object key, so `<Card größe={ 3 }>` emits the key `'größe'`.
- `startsWithObjectLiteral` raises the positioned error for `{ { a: 1 } }` (D173
  V8 — pass the object as a function argument or build it in `data()`).
- `identRunEnd` / `startsNonASCIIIdent` extend `parser.LexSkip` (ASCII only)
  through the non-ASCII runes `jsident` accepts, so `tokenizeJS`
  (`scriptcollide.go`), the one `<script>` scanner, reads `Straßenkarte` and
  `金額` as one name (D176 rule 8).
