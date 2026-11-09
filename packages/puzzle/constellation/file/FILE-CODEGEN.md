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
notes:
  - kind: state
    text: >-
      2026-11-08 codegen trims (feat/0.10-codegen-trims, review F6/V-codegen):
      SLOT_TAG/SNIPPET_TAG/PORTAL_TAG imports are now emission flags
      (usesSlot/usesSnippet/usesPortal set in emitNode), like the other six imports; the
      hasSlot/hasSnippet/hasPortal pre-walks are gone. The <script>-import collision warning is
      raised by the lowerer at the read's own position (noteImport), so the post-hoc __d. re-lexer
      is deleted. Module stamp is emitted only when Options.ModulePath is set (no basename
      fallback); the plugin leaves it empty in production SPA builds, so pzlc output and the codegen
      goldens carry no stamp. tplEscape → escapeTemplateText (a CR in a mixed attribute is now
      spelled \r). Also: singleRoot helper for the three single-root checks, inlineIf helper, one
      range emitFor arm, hasKeyAttr over isExplicitKeyAttr, sp via strings.Repeat, compile()'s
      duplicate Component-reserved check removed (emitComponentSlot keeps it, positioned at the
      <Component> use). TodoItem.compiled.js hand fixture regenerated from the compiler and pinned
      by TestGoldenTodoItem.
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
