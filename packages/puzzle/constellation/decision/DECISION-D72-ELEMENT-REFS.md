---
name: 'D72 — Element refs: static ref="name" → this.refs.name'
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-EVENTS
  - DOC-SPEC
  - DOC-SPEC-VIEW
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D62-HANDLER-CACHING
verified_at: '2026-07-17T23:27:05.105Z'
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/views/viewManager.js
  - client-runtime/ssg/serialize.js
---

# D72 — Element refs: static `ref="name"` → `this.refs.name`

A static `ref="name"` on a plain element binds its live DOM node to
`this.refs.name` on the owning PuzzleView: populated before `mounted()`,
re-pointed on keyed replacement, nulled on removal. `ref` is framework-owned
(like `key`/`island`/`flip`) and never reaches the DOM. Spec: [[DOC-SPEC-VIEW]]
§38.

## Decision

- **Static string only**, validated as a bare identifier. `ref={ x }` would be a
  data read under the expression language, and templates have no binding
  positions.
- **Emission:** `ref: this.__ref("name")` in the vnode attrs. `__ref` returns a
  per-instance cached setter (one identity per name, so the differ never churns
  it), keeping ViewManager view-agnostic.
- **Setter contract `(el, removed?)`:** mount/replacement call `setter(el)`;
  removal calls `setter(null, oldEl)`, which nulls `this.refs[name]` only if it
  still points at `oldEl` — so mount/remove order during keyed replacement
  doesn't matter. Setters are inert after destroy.
- **Lifecycle:** usable in `mounted()` without a guard. An `{#if}`-toggled
  element nulls on exit and repopulates on re-entry; use `?.` outside
  `mounted()`. `refs` is an instance field — never render data, never in HMR
  snapshots, dropped by the SSG serializer.
- **Compile errors** (`puzzle-lang/parser/refs.go`): dynamic, interpolated,
  empty or valueless `ref`; non-identifier name; `ref` on a component tag (use a
  callback prop such as `@ready`); on `<Children>`/`<Slot>`; on the
  `<puzzle-view>` root (that's `this.element`); inside `{#for}`, a
  `<puzzle-skeleton>` or a `<Snippet>` body; duplicate names in one template
  body.
- `ref` + `island` on one element is the intended combo for direct-DOM
  animation (D44). `refs` and `__ref` are reserved names.

## Alternatives

- **Callback refs (React-style)** — rejected: needs braces and a template `this`.
- **`this.$refs` (Vue)** — rejected: no `$` convention; `refs` matches
  `memo`/`events`/`animations`.
- **Array refs inside `{#for}`** — deferred (Vue 2's were order-unstable); the
  compile error holds the space.
- **`@ready` on plain elements** — rejected: `@name` on a plain element is
  always an event listener (D18).
- **`querySelector` in `mounted()`** — goes stale silently after keyed
  replacement.
