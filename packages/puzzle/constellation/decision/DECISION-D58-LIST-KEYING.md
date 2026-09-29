---
name: 'D58 — List keying: pk-aware auto-key, explicit key override, dev null-key warning'
status: verified
connections:
  - DECISION-D29-LOOP-COUNTER
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-MODEL
  - DOC-SPEC
  - TEST-TODOS-INTEGRATION
verified_at: '2026-07-14T07:07:57.217Z'
---

# D58 — List keying: pk-aware auto-key, explicit key override, null-key warning

## Decision
- **Runtime-resolved auto-key: `ViewNode.keyOf(item)`.** An item-form `{#for}` keys each row through this static helper, which resolves when the real object is in hand:
  - a store record (`item instanceof PuzzleModel`) → `item[item.constructor.primaryKey()]`, so template keying agrees with `.primary()`;
  - anything else → `item?.id`;
  - null/undefined → a dev-only warn-once naming the item, and `null` (positional fallback, now diagnosed).
- **Explicit key wins.** A `key` attribute (static or dynamic) on the `{#for}` body root replaces the synthetic key; `keyOf` is not applied to it. This is the override for non-record data with other identity fields. Keys must be stable and unique.
- **Range loops** key on the generated number — unique by construction.
- **Where the key lives** ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]): for a list block, the key function sits in the hoisted site meta (`const __L<n> = { key: (item) => ViewNode.keyOf(item), … }`) and the row root carries the block's resolved key; an explicit key becomes `(item) => <expr>` (or `(item, i) => …`) there. A key that reads render-scope state (`__d`, `__f`, `this`) cannot be a module-scope arrow, so that site — like range loops and loops inside a `<Snippet>` body — keeps the `.map(…)` emission with the key on the row root.
- **Warnings are dev-only** (`__PUZZLE_DEV__`): the null-key and duplicate-key warnings each fire once per session; a list block also warns when two rows collide on a key in one pass, since a shared key would alias two rows onto one row state.
- `keyOf` rides the already-imported `ViewNode` and is documented as internal (like `SLOT_TAG`).

## Alternatives rejected
- A compile warning only — custom-pk models would still silently lose keyed reconciliation, and non-`.id` data would have no override.
- Compile-time pk resolution from `models/` — the compiler never parses JS, and collections are arbitrary expressions.
- A new `__key` export — grows the public surface and churns every emitted import line.
- Duck-typing `primaryKey` instead of `instanceof` — false positives on user classes with a same-named static; the real import is cycle-free.
