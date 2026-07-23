---
name: v1.51 — FLIP keyed-reorder animation (D85)
status: building
connections:
  - DECISION-D85-FLIP-ATTRIBUTE
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ANIMATIONS
  - DOC-SPEC
  - FILE-VIEW-MANAGER
  - FILE-ANIMATE
  - FILE-SSG-SERIALIZER
---

# v1.51 — FLIP keyed-reorder animation (D85)

A `flip` directive attribute (bare or `flip={ { duration, easing } }`) on
keyed row roots animates retained elements from their old visual position to
their new one when keyed reconciliation moves them. Zero new template
grammar — `flip` joins `key`/`island`/`ref` in the directive strip lists.
Ship [[DECISION-D85-FLIP-ATTRIBUTE]].

## Scope

- In (runtime): NEW `client-runtime/views/flip.js`; `viewManager.js` —
  `flip` in the `setAttr`/`removeAttr` directive early-returns and a
  First/Last measure around `patchKeyedChildren`'s removal + move passes
  (First before removals; rects capture mid-flight transforms for rapid
  re-reorders; prior Puzzle FLIPs cancelled via WeakMap, foreign animations
  untouched); translation-only deltas ≥ 0.5px played over any base
  transform, defaults 250ms / cubic-bezier(0.2, 0, 0, 1), state released on
  settle; reduced-motion / missing-WAAPI / no-flip-attrs / unchanged-order
  paths cost no measurements; unkeyed-`flip` warn-once. `ssg/serialize.js`
  skips `flip`.
- Out (per D85): `animate:` syntax, width/height scaling, FLIP for
  inserts/leavers, wrapper elements.

## Acceptance

- Correct deltas for sorts/moves; retained rows keep DOM identity; inserts/
  leavers keep their existing animation paths; static transforms survive;
  rapid reorder restarts from the visual position; `flip` absent from DOM
  and SSG output; zero-cost fast paths verified by measurement spies; full
  vitest green.
