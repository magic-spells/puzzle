---
name: 'D29 — Loop counter binding: a trailing `, name` on `{#for}`'
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DECISION-D58-LIST-KEYING
---

# D29 — Loop counter binding: a trailing `, name` on `{#for}`

See [[DOC-SPEC-TEMPLATE]] §6.

## Decision
A trailing top-level `, identifier` on the loop header binds the **loop counter**:
- item form — `{#for post in posts, i}` binds `i` to the 0-based index;
- range form — `{#for 1...5, n}` binds `n` to the current number.

The counter is "where the loop is": 0-anchored for arrays, range-start-anchored for ranges. It is in scope everywhere in the body like the item variable. A range binds only one name, so value-and-index over a range cannot be written. Parsing is conservative: the tail after the last *top-level* comma counts only when it is a bare identifier. Keying is unaffected ([[DECISION-D58-LIST-KEYING]]).

Item and counter names follow the reserved-binding rule: identifiers starting with `__` and the names `ViewNode`, `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG` are compile errors.

## Alternatives rejected
- `{#each posts as post, i}` (Svelte) — a second loop keyword.
- `{#for posts as post, i}` — `for … as` is a mismatched word pair.
- `{#for post, i in posts}` (Vue) — the index lands mid-header, and the range form grows a value-and-index case nobody needs.
- An implicit `forloop.index` (Liquid) — reserved names, shadowing rules and `parentloop` chains.
