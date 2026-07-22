---
name: "D40 — `{:else if}`: conditional chaining (v1.9)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DECISION-D36-UNLESS
---

# D40 — `{:else if}`: conditional chaining (v1.9)

`{#if a} … {:else if b} … {:else} … {/if}` — zero or more `{:else if expr}` clauses between the `{#if}` body and the optional trailing `{:else}`; a parse-time desugar to nested `If` AST nodes with zero codegen surface. Settled (v1.9); additive. See [[DOC-SPEC]] §6 and [[DOC-TEMPLATE-SYNTAX]].

## Context

v1 shipped `{#if}…{:else}…{/if}` only; branch ladders required nesting, which indents one level per branch and reads badly past two rungs. The lexer already recognized `{:else if …}` as a dedicated `TokElseIf` token purely to reject it with a targeted error — so the token plumbing predated the feature. The old brainstorm app (`notes/post-v1-showcase-roadmap.md`) sketched exactly this syntax.

## Decision

D40 lands `{:else if}` as a purely additive amendment (like [[DECISION-D36-UNLESS]]): any number of `{:else if expr}` clauses may sit between the `{#if}` body and the optional `{:else}`, which must remain the **last** clause. `expr` is any JS expression, exactly like `{#if}`. Implementation is a **parse-time desugar**: each clause becomes an `If` node in its parent's `Else` list (built right-to-left), so **codegen is unchanged** and the runtime never sees a new construct. Existing `{#if}` templates are untouched.

**Spelling: `else if` (JavaScript), not `elsif` (Liquid/Ruby).** Puzzle's Liquid heritage is semantic (formatter pipes, `{#case}` matching), not orthographic — the block grammar is `{#if}`/`{:else}`-shaped and SPEC §6 promises plain JS expressions, so the JS spelling is the one users type reflexively. The lexer's unknown-branch error adds a did-you-mean for `{:elsif}`/`{:elseif}`.

Boundary rules preserved:

- `{:else if}` inside `{#unless}` — still a positioned compile error (D36's readability rationale stands).
- `{:else if}` inside `{#case}` — still a positioned compile error (use `{:when}`).
- Attribute-value inline-ifs — still rejected; the attr mini-grammar stays deliberately small (interpolation + flat `{#if}…{:else}` only).
- `{:else if}` after `{:else}` — positioned compile error (mirrors the `{:when}`-after-`{:else}` rule).
- Lexer tightened: `{:else <anything-but-if>}` is now an unknown-branch error instead of lexing as an else-if attempt; `TokElseIf.Value` carries the bare condition (as `TokWhen` does).

## Alternatives rejected

- **`{:elsif}` (Liquid spelling)** — a Ruby-ism in a JS-expression grammar; the most typo-prone keyword family there is. Rejected also as an alias: two spellings double the error-message surface forever.
- **Not supporting it** — nested `{#if}` blocks, the status quo this improves.
- **A dedicated `ElseIf`/chain AST node** — needless; right-to-left desugaring into the existing `If.Else` covers every case with zero codegen surface.
- **Allowing it in `{#unless}` / attribute inline-ifs** — unless/else-if ladders invert the reader's mental model at every rung (D36); the attribute mini-grammar is deliberately minimal.

## Consequences

Non-breaking: additive amendment (v1.9). Parser-only — lexer + parser + tests + one codegen golden; codegen, runtime, and all existing goldens byte-identical.
