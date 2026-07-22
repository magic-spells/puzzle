---
name: v1.29 — composition-layer fixes (handler caching, hidden-tab flush, memo)
kind: amendment
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D63-HIDDEN-TAB-FLUSH
  - DECISION-D64-MEMO-HELPER
  - DOC-THIRD-PARTY-DOM
  - DOC-SPEC
---

# v1.29 — composition-layer fixes

Three amendments in one bundle, all originating from the tarot-puzzle wrapper
build (2026-07-14, the friction list in
`tarot-puzzle/docs/PUZZLE-FRICTION.md`): wrapping a real third-party DOM
library stress-tested the component-boundary API and found the friction
concentrated in the composition layer, not the reconciler.

- **[[DECISION-D62-HANDLER-CACHING]]** (SPEC §31) — data-independent `@event`
  handlers compile to per-instance cached closures, so component callback
  props stop defeating `shallowEqual` (children stop re-running `data()` on
  every parent render) and cached DOM listener sites stop rebinding per patch.
  Resolves the round-1 known-deferred item.
- **[[DECISION-D63-HIDDEN-TAB-FLUSH]]** — store notification flush keeps rAF
  as primary but gains a `document.hidden` schedule-time branch and a
  fallback timer, so hidden-tab apps deliver (throttled) instead of freezing.
- **[[DECISION-D64-MEMO-HELPER]]** (SPEC §32) — `this.memo(key, deps,
  factory)` gives object/array props a blessed reference-stability idiom,
  replacing hand-rolled private-field caches.

Also in this bundle, documentation-only: the `@ready` **callback-ref idiom**
(a child hands its imperative handle up through a callback prop; parent stores
it on an instance field, never in `setData`) is blessed in DOC-EVENTS +
DOC-USER-GUIDE as Puzzle's answer to React refs / Vue `defineExpose` /
Svelte `bind:this`. A first-class `ref={…}` directive stays deferred until
demand appears — the idiom needs no framework code.

Friction items NOT addressed here, by decision: the islands/slots mutual
exclusion (documented in [[DOC-THIRD-PARTY-DOM]]; portal primitive stays
future-work), custom-element lifecycle ordering (platform behavior,
documentation only), and `.pzl`-in-node_modules packaging (still out of
scope; wrapper packages use the exported `ViewNode`/`SLOT_TAG` surface).
