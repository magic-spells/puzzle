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
notes:
  - kind: gotcha
    text: >-
      2026-09-11 — two correctness rules the row cache needs beyond §3.2's dirtiness list. (1) A
      block that MISSED a render may not trust the root mask: `view.__dirty` is a per-render delta,
      so a site whose `{#if}` was false — or a nested site whose enclosing row was cached, which is
      the same thing — never sees the bits that flipped while it was away, and by the next
      invocation the mask is clean. The block records the view's render counter (`view.__rgen`,
      bumped once per render in PuzzleView.#computeDirty) as `block.seen` and treats `rgen - seen >
      1` as "every row dirty this pass"; the row STATE survives, so handlers, static caches and
      nested blocks stay stable. A view that renders outside that counter (prerender, takeover)
      leaves `__rgen` at 0, so direct `listRows` calls and the SSG pass keep caching normally. (2)
      `collectControls` stops at an `island` element's children (D44 freezes them; replaying
      identity into one would reset a widget-owned input to its seed) while still collecting the
      island element's own `value`/`checked`, and it now walks THROUGH `<Portal>` children —
      patchPortal only runs when a patch actually reaches the portal vnode, and a cached ancestor
      returns first. Tests: tests/list-cache-invalidation.test.js,
      tests/list-control-replay.test.js.
  - kind: state
    text: >-
      D173 V12 (feat/core-expressions): the module also exports `loopItems(value)` and
      `loopRange(from, to)`, re-exported from the package root beside `listRows` and imported by a
      compiled module as `__e` / `__r` only when it emits a `.map` item loop / a range loop.
      `loopItems` returns an array as-is and one shared module-level empty array for anything else
      (dev warns once per shape for a non-null non-array) — nothing may push into what it returns;
      `listRows` runs its input through it first, so a lowered loop over a missing collection
      renders zero rows instead of throwing. `loopRange` truncates finite bounds to whole numbers
      and yields no iterations for a missing or non-finite bound (dev warns for either). The same
      "never import from inside client-runtime/" rule covers both: they ride the module only for
      apps whose templates loop.
---

Source binding for the owning component cards. Behavioral intent stays in [[DECISION-D170-INCREMENTAL-VDOM-LISTS]] and [[COMPONENT-PUZZLE-VIEW]]; this card anchors that decision to `client-runtime/views/listBlock.js`.

**Reachability is part of the contract.** This module is exported from the
package root as the compiler-support export `listRows`, and a compiled `.pzl`
imports it as `__l` only when it lowers at least one item-form `{#for}`. Nothing
inside `client-runtime/` may import it — least of all
`views/PuzzleView.js`, which every app pulls in. It is ~1 KB gzip on its own, so
one unconditional import would put the whole list runtime into a loop-free
hello-world and blow the D170 hello-world byte gate (+0.5 KB gzip). If a future
change needs the block from inside the runtime, move the shared part out rather
than adding the import.
