---
name: "D36 — `{#unless}`: inverted conditional (v1.7)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-TEMPLATE-PARSER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
---

# D36 — `{#unless}`: inverted conditional (v1.7)

`{#unless expr} … {/unless}` renders its body when `expr` is falsy (optional `{:else}` for truthy); a parse-time desugar to a negated `{#if}` with zero codegen surface. Settled (v1.7); additive. See [[DOC-SPEC]] §6 and [[DOC-TEMPLATE-SYNTAX]].

## Context
[[DOC-SPEC]] §6 deferred `{#unless}` alongside `{#switch}`. `{#unless done}` reads better than `{#if !(done)}` for the common guard-style template, and the desugar makes it nearly free to support (owner call).

## Decision
D36 lands `{#unless}` as a purely additive amendment (like [[DECISION-D28-ANIMATIONS]]/[[DECISION-D29-LOOP-COUNTER]]): `{#unless expr} … {/unless}` renders its body when `expr` is **falsy**, with an optional `{:else}` that renders when `expr` is truthy. `expr` is ANY JS boolean expression, exactly like `{#if}`. Implementation is a **parse-time desugar** to the existing `If` AST node with a precedence-safe negated condition (`!(expr)` — the parens guard against `&&`/`||`/ternary precedence traps); **codegen is unchanged**, so `{#unless}` costs nothing beyond the parser. Existing `{#if}` templates are untouched.

- **`{:else if}` inside `{#unless}` is a positioned compile error** suggesting an `{#if}` restructuring. Rejected supporting it by design: `unless … else-if` chains invert the reader's mental model at every rung and are unreadable — an author who needs a branch ladder should write `{#if}`.

## Alternatives rejected
- **Not supporting it** — keeping negation-only `{#if !(...)}`, the status quo this improves.
- **A dedicated `Unless` AST node** — needless; the negated `If` covers every case with zero codegen surface.
- **`{:else if}` inside `{#unless}`** — a positioned compile error; `unless … else-if` chains invert the reader's mental model at every rung.

## Consequences
Non-breaking: additive amendment (v1.7).
