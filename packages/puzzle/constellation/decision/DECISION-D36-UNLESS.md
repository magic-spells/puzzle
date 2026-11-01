---
name: 'D36 — `{#unless}`: inverted conditional'
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D36 — `{#unless}`: inverted conditional

See [[DOC-SPEC-TEMPLATE]] §6.

## Decision
`{#unless expr} … {/unless}` renders its body when `expr` is falsy, with an optional `{:else}` for truthy. `expr` is any expression `{#if}` accepts ([[DECISION-D176-EXPRESSION-LANGUAGE]]). The parser desugars it to an `If` node whose condition is `!(expr)` (the parens guard precedence), so codegen has no `unless` surface.

`{:else if}` inside `{#unless}` is a positioned compile error suggesting an `{#if}` restructure.

## Alternatives rejected
- A dedicated `Unless` AST node — the negated `If` covers every case.
- `{:else if}` inside `{#unless}` — unless/else-if ladders invert the reader's model at every rung.
