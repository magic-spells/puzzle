---
name: render code generator
status: verified
path: compiler/internal/codegen/codegen.go
language: go
summary: AST-to-ViewNode render emission, handlers, loops, slots, Component selection and arity padding.
connections:
  - COMPONENT-CODEGEN
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# codegen.go

Turns a parsed `.pzl` into its JS module ([[COMPONENT-CODEGEN]]): the `<script>`
emitted verbatim, an injected runtime import line, and an appended
`Name.prototype.render`. Expressions lower in [[FILE-CODEGEN-LOWER]], loops in
[[FILE-CODEGEN-LISTBLOCK]], static subtrees in [[FILE-CODEGEN-STATICCACHE]].

- **Output is byte-exact** against the golden files (`golden_test.go`) and the
  hand-written `tests/fixtures/todos/Home.compiled.js`; any emission change means
  regenerating goldens on purpose.
- **The file header is the normative text of the whitespace rule** (D168 / D173
  V10). Read it there before touching text emission.
- Runtime helpers join the import line only when a file uses them, so a module
  never drags in runtime it does not need (D89, D170).
