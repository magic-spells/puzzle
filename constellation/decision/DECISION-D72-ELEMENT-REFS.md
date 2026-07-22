---
name: 'D72 — Element refs: static `ref="name"` → `this.refs.name` (v1.39)'
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-TEMPLATE-SYNTAX
  - DOC-EVENTS
  - DOC-SPEC
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D62-HANDLER-CACHING
verified_at: '2026-07-17T23:27:05.105Z'
notes:
  - kind: verified
    text: >-
      Verified at merge: 13 Go packages green cold; vitest 764/764
      post-merge with the round-5 review changes (both suites coexisting); emission contract proven
      through a real production build — minified todos bundle contains
      ref:this.__ref("newTodoInput") exactly (call site + method definition = the only two __ref
      occurrences), no ref DOM attribute. Merge with round-5's viewManager/PuzzleView changes
      auto-resolved and re-verified.
---

# D72 — Element refs: static `ref="name"` → `this.refs.name` (v1.39)

A static `ref="name"` attribute on a plain element binds that element's live DOM node to `this.refs.name` on the owning PuzzleView — populated before `mounted()`, re-pointed on keyed replacement, nulled on removal. Framework-owned attribute (never reaches the DOM), compiled to a per-instance cached callback in the vnode. Settled (v1.39); additive. See [[DOC-SPEC]] §38 and [[DOC-EVENTS]].

## Context

DOC-EVENTS had explicitly deferred a first-class ref directive "until demand appears," blessing two idioms instead: the `@ready` callback prop for COMPONENT handles, and `this.element.querySelector(...)` in `mounted()` for a view's own elements. Demand appeared via the SVG-animation thread (2026-07-17): the sanctioned hot path for per-frame animation is `island` + direct DOM writes, and its first step is getting the node. `querySelector` is stringly (refactors break it silently) and — the sharp edge — a keyed replacement swaps the node and the captured reference goes stale with no signal. A patcher-managed ref closes exactly that hole.

## Decision

**Spelling: `ref="name"` — a static string, never an expression.** The braces form (`ref={ x }`) is unimplementable under the frozen expression boundary: template identifiers compile to data reads (§6), so `ref={ el }` would be a model lookup, and binding-position semantics inside expressions is precisely what the contract rejects. The static string is validated as a bare identifier (it becomes `this.refs.<name>`).

**Emission: `ref: this.__ref("name")` in the vnode attrs** — a compiled call to a new PuzzleView internal that returns a per-instance CACHED setter (one function identity per name for the life of the instance, [[DECISION-D62-HANDLER-CACHING]]'s lesson applied at birth: stable attr identity means the differ never churns the binding). This keeps the ViewManager view-agnostic — like event handlers, the closure carries the view; the patcher just calls a function.

**Setter contract `(el, removed?)` — removal is guarded.** Mount/replacement call `setter(el)`; removal calls `setter(null, oldEl)`, and the setter nulls `this.refs[name]` ONLY IF it still points at `oldEl`. The guard makes mount-then-remove and remove-then-mount orderings during keyed replacement equivalent, so the patcher needs no ref-specific sequencing. Setters are inert after view destruction.

**Lifecycle:** populated during mount, before `mounted()` fires — `this.refs.chart` is usable in `mounted()` with no guard. An `{#if}`-toggled element nulls on exit and repopulates with the NEW element on re-entry; consumers outside `mounted()` use the same `?.` discipline as `@ready`. `refs` is an instance field, not render data: never in `getData`/`setData`, never serialized by HMR snapshots, invisible to the SSG serializer (dropped like `@event`/`key`/`island`).

**Boundaries (all positioned compile errors):** dynamic/mixed/empty/valueless `ref`; a non-identifier name; `ref` on a component tag (use `@ready` — a component's root element is its own business); on `<slot>`; on the `<puzzle-view>` root (that's `this.element`); inside `{#for}` (per-iteration array refs deferred until demand); inside `<puzzle-skeleton>` (skeleton nodes are destroyed at the real-template swap); duplicate ref names in one template. `ref` + `island` on the same element is the HEADLINE combo (the D44 animation escape hatch's missing first step); the ref fires for the island element itself while its children stay frozen.

`refs` and `__ref` join the reserved names (§4).

## Alternatives rejected

- **`ref={ varName }` (the braces form)** — collides with the §6 expression boundary: identifiers in braces ARE data reads, and a lexer cannot see binding positions. Rejected for the same reason arrow functions and destructuring are.
- **Callback refs as the public API (React-style `ref={ this.setChart }`)** — same braces problem, plus it puts lifecycle bookkeeping on the user (the cached-setter machinery exists internally; users get the declarative string).
- **`this.$refs` (Vue spelling)** — Puzzle has no `$`-prefix convention; `refs` matches `memo`/`events`/`animations`.
- **Array refs inside `{#for}`** — Vue 2's v-for ref arrays were order-unstable and widely confusing; deferred until a real use case, with a compile error holding the space.
- **Repurposing `@ready` on plain elements** — overloads D18's per-node listener model with lifecycle semantics; `@anything` on a plain element is an addEventListener today, and silently changing that for one name is a trap.
- **Status quo (`querySelector` in `mounted()`)** — works until a keyed replacement stales the reference silently; the framework knows the node moved and should say so.

## Consequences

Non-breaking for the grammar (ref was previously just a pass-through HTML attribute; any template actually relying on a literal `ref` attribute reaching the DOM changes behavior — judged acceptable: it now has framework meaning, like `key`/`island` before it). Parser + codegen + ViewManager + SSG-serializer amendment; ref-free templates compile and patch byte-identically. Pairs with [[DECISION-D44-DOM-ISLANDS]] for the zero-diff animation path: `<svg island ref="scene">` + rAF in `mounted()`.
