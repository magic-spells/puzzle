---
name: "D58 — List keying: pk-aware auto-key, explicit key override, null-key warning"
status: verified
connections:
  - FEATURE-V1-26-LIST-KEYING
  - DECISION-D29-LOOP-COUNTER
  - DECISION-D43-FORMATTER-MISSING-GUARD
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-MODEL
  - DOC-SPEC
verified_at: '2026-07-14T07:07:57.217Z'
notes:
  - kind: verified
    text: >-
      Verified at ship: contract implemented as written (ViewNode.keyOf emission, hasKeyAttr
      override suppression, warn-once null path); goldens + hand-written fixture updated
      fixture-first; Go +6 codegen tests, vitest +4 incl. custom-pk reorder-by-move; 540 vitest +
      all Go green.
---

# D58 — List keying: pk-aware auto-key, explicit key override, null-key warning

Settled (v1.26). `{#for}` list keying stops assuming `.id` and stops colliding
with user intent: the compiler emits a **runtime key resolver** instead of the
hardcoded `item.id`, an **explicit `key={ … }` on the body root replaces** the
synthetic key instead of silently duplicating it, and a row whose key resolves
to null/undefined **warns once** in dev instead of silently dropping the list
to positional diffing.

## Context

Three defects shared one root — the synthetic `key: item.id` the compiler
prepends to every item-form `{#for}` body root (codegen `forBody`):

1. **The `.id` assumption contradicts the model layer.** `.primary()` has been
   honored by the store since v1 — records index, dedupe, and save by
   `Model.primaryKey()`. But the compiler can't see models (a loop collection
   is just an expression), so a model with `main_id: Puzzle.string().primary()`
   got `key: item.id` → `undefined` → every key null → **silent positional
   diffing**. The two halves of the framework disagreed about identity.
2. **Explicit keys doubled.** Muscle memory from React/Vue writes
   `key={ todo.id }` on the row root. The compiler prepended its synthetic key
   anyway, emitting a duplicate `key:` property in the attrs literal —
   accepted JS (last wins) with observed rendered-list doubling
   ([[TEST-TODOS-INTEGRATION]] recorded it as "NO explicit key or it
   doubles"). Do the thing every other framework taught you → broken list,
   zero diagnostics.
3. **Null keys were silent.** `attrs.key = undefined` → `ViewNode.key = null`
   → the keyed path never engages. No warning existed (the existing
   duplicate-key warning fires only when keys EXIST and collide).

The plan carried this as a "compile warning" paper-cut item; working it
through upgraded it to fixing the actual inconsistency.

## Decision

- **Runtime-resolved auto-key: `ViewNode.keyOf(item)`.** Item-form `{#for}`
  emits `key: ViewNode.keyOf(item)` instead of `key: item.id`. The static
  helper resolves at render time, when the real object is in hand:
  - store record (`item instanceof PuzzleModel`) → `item[item.constructor.primaryKey()]`
    — template keying automatically agrees with whatever `.primary()` says;
  - anything else → `item?.id` (v1 behavior, unchanged for the common case);
  - resolved null/undefined → **warn once** (dev-visible; production builds
    already drop `console.*`) naming the item, and return null (positional
    fallback, now diagnosed instead of silent).
- **Riding on `ViewNode`, not a new export.** The helper is a static on the
  already-imported `ViewNode` — the emitted import line is byte-identical, no
  new public name in the package surface. Same posture as D43's
  `__f.__missing` (ride an object the emitted code already holds).
- **Explicit key wins.** If the `{#for}` body root (element or component)
  carries a `key` attribute — static or dynamic — the compiler **skips the
  synthetic prepend entirely** and the author's attribute stands, in both item
  and range forms. This converts the collision into the sanctioned override
  for non-record data with other identity fields (raw API rows, `main_id`
  before it's modeled, computed rows). Keys must be stable and unique;
  `keyOf` is NOT applied to the override (the author said what identity is).
- **Range form unchanged.** Range/counter keys are the generated numbers —
  unique by construction; no resolver call, byte-identical emission.
- **Keys elsewhere unchanged.** `key` on non-root elements (e.g. the grimoire
  island title's replace-on-change key) already passed through untouched and
  still does.

## Rejected alternatives

- **Compile warning only** (the original plan item): teaches the convention
  but leaves defect 1 — custom-pk models still silently lose keyed
  reconciliation, and no-`.id` data has no escape hatch.
- **Compile-time pk resolution:** the compiler reading `models/` to infer the
  loop collection's type. Rejected: the compiler never parses JS (SPEC §4),
  collections are arbitrary expressions, and the coupling would be wrong the
  moment a computed array crosses a model boundary.
- **`__key` as a new named export:** works, but grows the public surface and
  churns the emitted import line in every file with a loop; the ViewNode
  static costs nothing.
- **Duck-typing (`typeof item?.constructor?.primaryKey === 'function'`)
  instead of `instanceof`:** avoids the model import in ViewNode.js but
  false-positives on user classes with a same-named static; the real import
  is cycle-free (model.js imports nothing from views/).

## Consequences

- Emitted code changes for every item-form loop → per-construct goldens
  regenerated; the hand-written todos fixture (the byte-contract — "the
  fixture wins") updated first, compiler matched to it.
- `ViewNode.keyOf` is technically reachable by users; documented as internal
  (like `SLOT_TAG`).
- The null-key warn-once set is module-level (matches `warnDuplicateKey`);
  warns at most once per model type/shape encounter to stay quiet in loops.
