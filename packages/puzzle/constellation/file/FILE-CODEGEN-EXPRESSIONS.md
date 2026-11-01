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
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# expr.go

Small lexical helpers the emitters share; template expressions themselves are
lowered from their AST in [[FILE-CODEGEN-LOWER]].

- `isJSIdentifier` is ASCII-only on purpose: it decides whether a prop name can be
  an unquoted object key, so `<Card größe={ 3 }>` emits the key `'größe'`.
- `startsWithObjectLiteral` raises the positioned error for `{ { a: 1 } }` (D173
  V8 — pass the object as a function argument or build it in `data()`).
- `identRunEnd` / `startsNonASCIIIdent` extend `parser.LexSkip` (ASCII only)
  through the non-ASCII runes `jsident` accepts, so the `<script>` scans
  (`tokenizeJS` and the `__d.` collision scan in `scriptcollide.go`) read
  `Straßenkarte` and `金額` as one name (D176 rule 8).
