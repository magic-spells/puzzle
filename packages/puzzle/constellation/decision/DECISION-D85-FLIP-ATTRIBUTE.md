---
name: D85 — FLIP keyed-reorder animation via a flip directive attribute
status: verified
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ANIMATIONS
  - DOC-SPEC
  - DOC-SPEC-VIEW
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D72-ELEMENT-REFS
  - FILE-VIEW-MANAGER
  - FILE-ANIMATE
  - FILE-SSG-SERIALIZER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# D85 — FLIP keyed-reorder animation via a `flip` directive attribute

Keyed list rows opt into FLIP position animation with a `flip` attribute on the
keyed row root — bare, or `flip={ flipOptions }` with the options object built
in `data()` (a template expression can't start with an object literal). Retained
rows that move during keyed reconciliation animate from their old visual
position; inserts and removes keep their own enter/leave paths. Spec:
[[DOC-SPEC-VIEW]] §46.

## Decision

- **A directive attribute, not a namespace.** `flip` parses as an ordinary
  attribute and joins `key`/`island`/`ref` as a framework-owned vnode attr
  (`reservedVnodeAttrs`): stripped by `setAttr`/`removeAttr` and the SSG
  serializer, never in the DOM. `flip` must be stripped everywhere those are.
  `flip` on an unkeyed row warns once at runtime.
- **Runtime** (`views/flip.js`, keyed reconciliation only): first-measure after
  pairing and before the removal pass (removals reflow); rects include live
  transforms, so a rapid re-reorder starts from the true mid-flight position,
  then cancels the prior Puzzle FLIP (a WeakMap tracks only our animations).
  Translation only; deltas under 0.5px skip; an existing base transform is
  composed under the correction and restored. Defaults 250ms /
  `cubic-bezier(0.2, 0, 0, 1)`; malformed options fall back. State is released
  on settle so author CSS stays authoritative.
- `prefers-reduced-motion` or no WAAPI → zero measurement work; a list without
  `flip` costs one scan of the pair list.
- **Per-app inclusion (D89):** the build's `.pzl` usage scan detects `flip` in
  element attrs, **component props** (a component vnode's props are its attrs —
  `<PostCard … flip>` is a real flip row) and slot children, and emits
  `__PUZZLE_HAS_FLIP__`; with none, `flip.js` tree-shakes out. A `flip` seen at
  runtime when support was compiled out (e.g. only in `node_modules`, which the
  scan skips) logs a dev-only warning once.

## Alternatives

- **`animate:flip` directive namespace** (Svelte) — rejected: grammar ripple
  through parser, goldens, three editor grammars and the lint/format plugins for
  identical behavior.
- **Loop-level opt-in (`{#for … flip}`)** — rejected: the animated element is
  the row root, where `key` already lives.
- **FLIP for inserts/leavers** — rejected: both already have owned animation
  paths; double-driving creates ghost elements.

## Consequences

Author-controlled transform *animations* on the same element can conflict (use a
wrapper element); static transforms are safe.
