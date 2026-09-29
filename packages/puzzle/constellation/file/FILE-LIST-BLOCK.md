---
name: persistent list blocks
status: built
path: client-runtime/views/listBlock.js
language: javascript
summary: 'Row state per key for one {#for} site: cached row vnodes, dirtiness rules, control collection.'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
---

# listBlock.js

Per-site row state for item-form `{#for}` ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]):
`listRows` returns cached row vnodes for rows whose inputs did not change. Also
exports the D173 loop guards `loopItems` and `loopRange`.

**Reachability is part of the contract.** All three are re-exported from the
package root, and a compiled `.pzl` imports them (`listRows as __l`,
`loopItems as __e`, `loopRange as __r`) only when it emits that loop shape.
Nothing inside `client-runtime/` may import this module — least of all
`views/PuzzleView.js`, which every app pulls in; one unconditional import puts
the list runtime (~1 KB gzip) into a loop-free hello-world and breaks the D170
byte gate. If the runtime needs something from here, move the shared part out.

Row-cache rules beyond the D170 dirtiness list:

- **A block that missed a render may not trust the root mask.** `view.__dirty`
  is a per-render delta, so a site whose `{#if}` was false (or a nested site
  whose enclosing row was cached) never sees bits that flipped meanwhile. The
  block records the view's render counter (`view.__rgen`, bumped once per render
  in `PuzzleView.#computeDirty`) as `block.seen` and treats `rgen - seen > 1` as
  "every row dirty"; row state survives, so handlers, static caches and nested
  blocks stay stable. Prerender/takeover renders leave `__rgen` at 0 and cache
  normally.
- **`collectControls`** (control-value replay into cached rows) stops at an
  `island`'s children but still collects the island element's own
  `value`/`checked`; walks through `<Portal>` children (a cached ancestor returns
  before `patchPortal` runs); and walks through a component vnode into its
  children (the parent's slot content), matching codegen's `forBodyHasControl`.
  Not reached, by construction: a control inside a `<Snippet>` body (stamped
  fresh by the child) and a control that is itself a named-slot fill (cloned by
  `stripSlotAttr`, so the parent's vnode never gets an `el`); a control nested
  inside a named-slot fill element is reached.
- `loopItems` returns an array as-is and one shared empty array for anything
  else (dev warns once per shape for a non-null non-array) — never push into what
  it returns. `listRows` runs its input through it, so a loop over a missing
  collection renders zero rows. `loopRange` truncates finite bounds and yields
  nothing for a missing or non-finite bound (dev warns).

Tests: `tests/list-block`, `list-cache-invalidation`, `list-control-replay`,
`list-control-slot`, `list-row-identity`, `list-counters`.
