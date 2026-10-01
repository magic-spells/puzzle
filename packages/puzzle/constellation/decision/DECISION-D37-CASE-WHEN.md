---
name: 'D37 — `{#case}` / `{:when}`: multi-branch block, strict `===`, no fallthrough'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
---

# D37 — `{#case}` / `{:when}`: multi-branch block

See [[DOC-SPEC-TEMPLATE]] §6.

## Decision
`{#case expr}` + one or more `{:when v1, v2, …}` clauses (top-level commas are OR; the splitter respects nesting and strings) + an optional trailing `{:else}`. Matching is strict `===`, first match wins, **no fallthrough**.

Codegen uses a dedicated `Case` node, not a desugar: an IIFE binds the case expression to a temp **once**, then chains ternaries over the clauses — safe for getter-backed or side-effecting expressions. The usage scan walks `case` bodies like any other.

Positioned compile errors: missing case expression; no `{:when}`; non-whitespace content before the first `{:when}`; a valueless `{:when}`; `{:when}` after `{:else}`; `{:else if}` inside a case; `{:when}` outside a case; unclosed or mismatched closers.

## Alternatives rejected
- `{#switch}` / `{:case}` naming — implies JavaScript's fallthrough and `break`; the Liquid `case`/`when` pair matches the semantics.
- Desugaring to nested `{#if}`s — re-evaluates the case expression once per clause.
