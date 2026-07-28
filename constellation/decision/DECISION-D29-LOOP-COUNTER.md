---
name: "D29 — Loop counter binding: trailing `, name` on `{#for}` (v1.2)"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DECISION-D28-ANIMATIONS
notes:
  - kind: state
    text: >-
      SLOT_TAG joined ViewNode in the compiler-reserved loop-binding set (pre-release review,
      fix/prerelease-review): {#for SLOT_TAG in rows} with a <Slot/> in the body previously compiled
      without error to `rows.map((SLOT_TAG) => …new ViewNode(SLOT_TAG)…)` — the loop value silently
      became the outlet tag (verified via pzlc). Both item and counter positions route through
      loopBindingIdentError, and the error message now names both reserved identifiers alongside the
      __ prefix rule. If the reserved-name list graduates into SPEC prose, this is the tightening to
      record.
    sha: 1c7b19e
---

# D29 — Loop counter binding: trailing `, name` on `{#for}` (v1.2)

An additive amendment to the frozen `{#for}` grammar: a trailing top-level `, identifier` on the loop header binds the 0-based index (item form) or the current number (range form). Settled (v1.2); see [[DOC-SPEC-TEMPLATE]] §6 and [[DOC-TEMPLATE-SYNTAX]].

## Context
v1's `{#for}` ([[DOC-SPEC-TEMPLATE]] §6, two forms) had no way to read the loop position. D29 adds a purely additive amendment — like the v1.1 animations amendment ([[DECISION-D28-ANIMATIONS]]), it extends the frozen grammar without breaking it: a trailing top-level `, identifier` on the loop header binds the **loop counter**.

## Decision
- **Item form** — `{#for post in posts, i}` binds `i` to the 0-based index of `post` in `posts`.
- **Range form** — `{#for 1...5, n}` binds `n` to the current number (1 through 5).

One grammar rule covers both: the counter is "where the loop is" — anchored at 0 for arrays, at the range start for ranges. It is in scope everywhere in the block body exactly like the item variable (interpolations, dynamic attributes, event-handler args). **Keying is unaffected:** the item form still keys on `item.id`; the named range form keys on the bound number (unique within a range). **Parsing is conservative** — the tail after the last *top-level* comma is only treated as a counter when it is a bare identifier, so existing collection expressions containing commas (inside parens/brackets) are untouched. Because the counter attaches via the trailing comma, a range only ever binds ONE name (the number); the degenerate value-AND-index-over-a-range case cannot be written.

Compiled emission: item form → `__d.items.map((item, i) => …)`; named range form → `Array.from({ length: to - from + 1 }, (_, __i) => from + __i).map((n) => …)`.

## Alternatives rejected
- **`{#each posts as post, i}` (Svelte).** Rejected: introduces a second loop keyword alongside the frozen `{#for item in items}` — two ways to write a loop.
- **`{#for posts as post, i}` / `{#for 1...5 as n}`.** Structurally clean (sequence first, bindings after `as`, index last; `as` binds "what the sequence yields", which dissolves the value-vs-index question) but rejected because `for … as` is a mismatched word pair — `for` wants `in`, `as` belongs with `each`, and `each` was already rejected.
- **`{#for post, i in posts}` (Vue-style, bindings before `in`).** Rejected on readability, especially the range case `{#for n, i in 3...7}`: the index lands mid-header instead of at the end where Svelte/Ember/Vue users expect it, and the range form would force a value-AND-index corner case nobody needs.
- **Implicit Liquid-style `forloop.index` magic variable.** Rejected: reserved names, shadowing rules, `parentloop` chains for nested loops — every modern framework converged on explicitly named bindings.

## Consequences
Non-breaking: [[DOC-SPEC-TEMPLATE]] §6's two v1 forms remain valid; this is an additive amendment (v1.2).
