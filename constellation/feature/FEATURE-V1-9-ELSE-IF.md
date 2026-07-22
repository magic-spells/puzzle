---
name: "v1.9 — `{:else if}` conditional chaining"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D40-ELSE-IF
  - COMPONENT-TEMPLATE-PARSER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
---

# v1.9 — `{:else if}` conditional chaining

`{#if a} … {:else if b} … {:else} … {/if}` lands as an additive grammar amendment: multi-branch conditionals without nesting. Driven by [[DECISION-D40-ELSE-IF]].

## Intent

Branch ladders previously required nested `{#if}` blocks (one indent level per rung). The lexer already emitted a dedicated `TokElseIf` token just to reject the syntax with a targeted error, so acceptance was nearly free: flip the rejection into parsing and desugar.

## Scope

**In:**
- Zero or more `{:else if expr}` clauses between the `{#if}` body and the optional trailing `{:else}` (which must stay last); `expr` is any JS expression. Parse-time desugar to nested `If` AST nodes (each clause becomes an `If` in its parent's `Else` list, built right-to-left) — **codegen unchanged**. Works everywhere the full template grammar runs, including `<puzzle-skeleton>` sections.
- Lexer tightening: `TokElseIf` now matches only `else` + `if` (Value = bare condition, like `{:when}`); `{:else foo}` is an unknown-branch error; `{:elsif}`/`{:elseif}` get a did-you-mean pointing at `{:else if}`.
- Positioned compile errors: empty condition, `{:else if}` after `{:else}`, outside `{#if}`, inside `{#unless}`/`{#case}` (unchanged messages), and in attribute-value inline-ifs.

**Out (rejected):** the `{:elsif}` spelling (and any alias); a dedicated chain AST node; `{:else if}` inside `{#unless}` or the attribute mini-grammar. See [[DECISION-D40-ELSE-IF]].

## Outcome

Shipped in v1.9; documented in [[DOC-SPEC]] §6 and [[DOC-TEMPLATE-SYNTAX]]. Parser-only amendment — touched [[COMPONENT-TEMPLATE-PARSER]] (lexer + parser + attr mini-grammar error) plus tests and one codegen golden (`else_if`); codegen and runtime untouched, existing goldens byte-identical.
