---
name: "v1.2 — Loop counter binding"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - DECISION-D29-LOOP-COUNTER
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
---

# v1.2 — Loop counter binding

A trailing `, name` on a `{#for}` header binds the 0-based index (item form) or the current number (range form), additively over SPEC §6's two frozen loop forms. Driven by [[DECISION-D29-LOOP-COUNTER]].

## Intent
v1's `{#for}` (two forms) had no way to read the loop position — no index for arrays, no current number surfaced for ranges. Templates that needed "which iteration is this" had no in-grammar answer.

## Scope
**In:** a trailing top-level `, identifier` on the loop header — item form `{#for post in posts, i}` binds the 0-based index; range form `{#for 1...5, n}` binds the current number. One grammar rule ("where the loop is": 0 for arrays, range-start for ranges); the counter is in scope everywhere in the block body like the item variable. Conservative parsing (only a bare identifier after the last top-level comma is treated as a counter, so collection expressions containing commas are untouched); keying unaffected (item form keys on `item.id`, named range form keys on the bound number).
**Out (rejected):** the `{#each ... as post, i}` Svelte keyword, `{#for ... as ...}`, Vue-style bindings-before-`in`, and implicit Liquid `forloop.index` magic variables — each rejected in [[DECISION-D29-LOOP-COUNTER]], which also records the compiled emission shapes.

## Outcome
Shipped in v1.2; documented in [[DOC-SPEC]] §6 and [[DOC-TEMPLATE-SYNTAX]]. A purely additive amendment — SPEC §6's two v1 forms remain valid. Touched [[COMPONENT-TEMPLATE-PARSER]] (header parse) and [[COMPONENT-CODEGEN]] (emission).
