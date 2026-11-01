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
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D85 — FLIP keyed-reorder animation via a `flip` directive attribute

A keyed `{#for}` row root opts into FLIP position animation with `flip` — bare,
or `flip={ flipOptions }` with the options object built in `data()` (a template
expression can't start with an object literal). Retained rows that move during
keyed reconciliation animate from their old position; inserts and removes keep
their own enter/leave paths. Spec: [[DOC-SPEC-VIEW]] §46.

## Decision

- **A directive attribute, not a namespace.** `flip` joins `key`/`island`/`ref`
  as a framework-owned vnode attr (`reservedVnodeAttrs` in codegen): stripped by
  `setAttr`/`removeAttr` and the SSG serializer, never in the DOM. Anywhere those
  three are stripped, `flip` must be too. `flip` on an unkeyed row warns once.
- **Runtime** (`views/flip.js`, keyed reconciliation only): measure after
  pairing and before the removal pass (removals reflow). Rects include live
  transforms, so a rapid re-reorder starts from the true mid-flight position,
  then cancels the prior Puzzle FLIP (a WeakMap tracks only our animations).
  Translation only; deltas under 0.5px skip; an existing base transform is
  composed under the correction and restored. Defaults 250ms /
  `cubic-bezier(0.2, 0, 0, 1)`; malformed options fall back. State is released
  on settle so author CSS stays authoritative.
- `prefers-reduced-motion` or no WAAPI → no measurement; a list without `flip`
  costs one scan of the pair list.
- **Inclusion is per app (D89):** the usage scan detects `flip` on elements,
  component invocations (a component vnode's props are its attrs, so
  `<PostCard … flip>` is a real flip row) and slot children, and sets
  `__PUZZLE_HAS_FLIP__`; with none, `flip.js` tree-shakes out.
- **`flip` must be written in the template.** One inside a `{...spread}` or set
  by pre-compiled JavaScript is invisible to the scan; if no template writes
  `flip`, support is compiled out and the row reorders without animating (a
  dev-only warning fires once). Deliberate: FLIP is an authored choice on the
  row, not a dynamic value. `flip` on `<Component>` (D180) is a compile error —
  wrap it in an element.

## Alternatives rejected

- **`animate:flip` namespace** (Svelte) — grammar ripple through parser, goldens,
  three editor grammars and the lint/format plugins for identical behavior.
- **Loop-level opt-in (`{#for … flip}`)** — the animated element is the row
  root, where `key` already lives.
- **FLIP for inserts/leavers** — both have owned animation paths; double-driving
  creates ghost elements.

## Gotchas

An author transform *animation* on the same element can conflict (use a wrapper
element); static transforms are safe.
