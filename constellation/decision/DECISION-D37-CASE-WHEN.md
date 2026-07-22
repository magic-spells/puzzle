---
name: "D37 — `{#case}` / `{:when}`: Liquid-style multi-branch block (v1.7)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
---

# D37 — `{#case}` / `{:when}`: Liquid-style multi-branch block (v1.7)

Multi-branch conditional shipped as `{#case expr}` + `{:when v1, v2, …}` clauses + optional `{:else}`; strict `===`, first-match-wins, no fallthrough, via a dedicated `Case` AST node. Chosen over `{#switch}`/`{:case}`. Settled (v1.7); additive. See [[DOC-SPEC]] §6 and [[DOC-TEMPLATE-SYNTAX]].

## Context
[[DOC-SPEC]] §6 deferred multi-branch conditionals under the name `{#switch}`. D37 ships the feature but **chooses `{#case}` / `{:when}` naming over `{#switch}` / `{:case}`** — Puzzle's formatter heritage is Liquid (whose tag is `{% case %}` / `{% when %}`), and the JS keyword `switch` carries fallthrough/`break` connotations this block deliberately does **not** have.

## Decision
Syntax: `{#case expr}` + one or more `{:when v1, v2, …}` clauses (top-level commas are **OR** — a splitter that respects nesting and string literals) + an optional trailing `{:else}`. Matching is strict `===`, **first match wins, NO fallthrough**.

- **Codegen is a dedicated `Case` AST node**, not a desugar. It emits an IIFE that binds the case expression to `__c` **exactly once**, then chains ternaries over the clauses (`__c === v1 || __c === v2 ? … : …`). Desugaring to nested `{#if}`s was **rejected**: it re-evaluates the case expression once per clause, which is wrong for getter-backed or side-effecting expressions — the single `__c` binding is getter-safe. Formatter tree-shaking ([[DECISION-D31-FORMATTER-TREESHAKE]]) walks `case` bodies so branch-only formatters are retained.
- **Compile errors (positioned, not warnings):** missing case expression; zero `{:when}` clauses; non-whitespace content before the first `{:when}`; a valueless `{:when}`; a `{:when}` after `{:else}`; `{:else if}` inside a case; a `{:when}` outside any case; unclosed / mismatched closers.

## Alternatives rejected
- **`{#switch}`/`{:case}` naming** — wrong dialect signal — implies fallthrough/`break` semantics absent here, and breaks the Liquid lineage.
- **Desugaring to nested ifs** — per-clause re-evaluation of the case expression, wrong for getter-backed or side-effecting expressions.

## Consequences
Non-breaking: additive amendment (v1.7).
