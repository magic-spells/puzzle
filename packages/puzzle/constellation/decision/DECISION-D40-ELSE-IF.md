---
name: 'D40 — `{:else if}`: conditional chaining'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DECISION-D36-UNLESS
---

# D40 — `{:else if}`: conditional chaining

See [[DOC-SPEC-TEMPLATE]] §6.

## Decision
Any number of `{:else if expr}` clauses may sit between the `{#if}` body and the optional `{:else}`, which stays last. The parser desugars each clause into an `If` nested in its parent's `Else` (built right to left), so codegen and the runtime see no new construct. The lexer's `TokElseIf` carries the bare condition.

Spelling is `else if` (JavaScript), not `elsif`. The lexer gives a did-you-mean for `{:elsif}`/`{:elseif}`, and `{:else <anything but if>}` is an unknown-branch error.

Positioned compile errors: `{:else if}` inside `{#unless}` ([[DECISION-D36-UNLESS]]) or `{#case}` (use `{:when}`); `{:else if}` after `{:else}`; `{:else if}` in an attribute value — the attribute mini-grammar stays interpolation plus one flat `{#if}…{:else}…{/if}`.

## Alternatives rejected
- `{:elsif}`, even as an alias — a Ruby-ism in a JavaScript-expression grammar, and two spellings double the error surface.
- A dedicated `ElseIf` node — the right-to-left desugar covers every case.
