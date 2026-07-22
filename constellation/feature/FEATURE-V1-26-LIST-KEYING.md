---
name: "v1.26 — List keying: pk-aware auto-key, explicit key override, null-key warning"
status: verified
connections:
  - DECISION-D58-LIST-KEYING
  - DECISION-D29-LOOP-COUNTER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-MODEL
  - TEST-TODOS-INTEGRATION
  - DOC-SPEC
verified_at: '2026-07-14T07:08:15.922Z'
---

# v1.26 — List keying

The plan's "auto-key doubling paper cut" item, upgraded during design review
to fix the underlying inconsistency. Driven by [[DECISION-D58-LIST-KEYING]];
contract in [[DOC-SPEC]] §28.

## Intent

`{#for}` keying had three silent failure modes sharing one root (the
hardcoded synthetic `key: item.id`): custom `.primary()` models lost keyed
reconciliation invisibly (store and template disagreed about identity), an
explicit `key={…}` written from React/Vue muscle memory emitted a duplicate
`key:` property (observed rendered doubling), and null keys degraded to
positional diffing with zero diagnostics.

## Scope

**In (shipped):**
- Item-form auto-key emits `ViewNode.keyOf(item)` — a static on the
  already-imported `ViewNode` (no new import surface): `PuzzleModel`
  instances key by `constructor.primaryKey()`, other values by `.id`,
  null/undefined warns once and returns null (diagnosed positional
  fallback).
- An explicit `key` attribute (static or dynamic) on the `{#for}` body root
  (element or component, item or range form) suppresses the synthetic
  prepend — the author's expression stands, `keyOf` not applied.
- Range/counter forms byte-identical (numbers are unique by construction).

**Out (rejected in D58):** compile-warning-only; compile-time pk inference
(compiler never parses JS); a new `__key` named export; duck-typed record
detection.

## Outcome

Shipped in v1.26. Codegen (`emitFor`/`forBody` + `hasKeyAttr`, `ViewNode`
marked in-scope for the resolver) + one ViewNode static + warn-once. Goldens
(`keyed_for`, `indexed_for`, `inline_svg`) and the hand-written todos fixture
updated (fixture first — the fixture wins). Go +6 codegen tests
(`listkey_test.go`); vitest +4 (`tests/list-keying.test.js`, incl. a
ViewManager reorder-by-move proof for custom-pk records). Suite green at
540 vitest + all Go packages.

Known edge (recorded in D58): a `PuzzleModel` whose primary-key VALUE is
null/undefined returns it unwarned (the warn guards the `.id` fallback
branch); records get pks at create time so this is theoretical — diagnose it
in a later pass if it ever bites.
