---
name: render code generator
status: verified
path: compiler/internal/codegen/codegen.go
language: go
summary: AST-to-ViewNode render emission, handlers, loops, slots, Component selection and arity padding.
connections:
  - COMPONENT-CODEGEN
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
notes:
  - kind: state
    text: >-
      The `SLOT_TAG`/`SNIPPET_TAG`/`PORTAL_TAG` imports are emission flags
      (`usesSlot`/`usesSnippet`/`usesPortal`, set in `emitNode`) like the other helper imports;
      there is no pre-walk. The `<script>`-import collision warning is raised by the lowerer at the
      read's own position (`noteImport`). The `Class.__pzlModule` stamp is emitted only when
      `Options.ModulePath` is set, so a production SPA build, pzlc output and the codegen goldens
      carry none. `TodoItem.compiled.js` is pinned by `TestGoldenTodoItem`, beside the Home and
      Default goldens.
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
