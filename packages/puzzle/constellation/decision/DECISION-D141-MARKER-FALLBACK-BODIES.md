---
name: 'D141 — Marker fallback bodies'
status: verified
connections:
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC-TEMPLATE
verified_at: '2026-08-16T04:33:05.094Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Composition markers accept a paired form whose body is fallback content —
`<Children>…</Children>`, `<Slot name="x">…</Slot>`, `<Slot>…</Slot>`. The
fallback renders only when nothing fills that position; content supplied by the
call site (or the router) replaces it entirely. Self-closing markers are the
empty form — no fallback, render nothing when unfilled — and an empty paired
body means the same. Markers are capitalized; lowercase spellings are
positioned compile errors steering to the capitalized forms (D134).

## Contract

- **Uniform across the one mechanism.** `<Children>` and bare `<Slot>` are the
  same AST node, so fallback behaves identically in all three positions:
  component default content, named-slot fallback, and the router outlet — which
  shows its fallback when no child route occupies it (a parent route rendering
  as the leaf).
- **A fallback body is ordinary template content.** Interpolations (including
  formatter pipes), `{#if}`/`{#for}`/`{#case}` blocks, components, event
  bindings, refs, and `{#svg}` inline SVG (D46) all parse and compile through
  the same paths as any element body — the fallback children ride
  `emitElement`'s child emission; nothing is special-cased. A composition
  marker inside another marker's fallback body is a positioned compile error
  (no coherent expansion order; relaxable if a real case appears).
- **No public is-slot-filled probe.** The runtime's marker expansion knows
  whether a position was filled, which is all fallback needs. A testable-slots
  API remains a separate, unclaimed decision.
- **Implementation surface:** `Slot.Children` in the AST, paired-marker
  parsing, codegen fallback emission, the runtime `expandChildList` fallback
  branch, and fallback-content traversal in a11y, refs, and the class scan.
  Golden churn is acceptable (compiler-over-runtime-bytes: the runtime cost is
  one branch).

## Rationale

Component-owned default content — stock chrome unless the caller supplies its
own — is the standard slot contract (Vue, native web components, Astro,
Angular 18+), and the registry needs it: six pieces (HoverCard, Popover,
Popconfirm, DropdownMenu, EmojiPicker, EmojiPickerSimple) carry either/or
trigger contracts that prop-conditionals cannot express when the gating prop
always has a value (the emoji pickers' `label` is their aria-label). Fallback
bodies cover that need with zero new public API.

## Consequences

- The six trigger pieces (registry + demo + docs-site copies, kept in
  lockstep as mirrors) express their stock trigger chrome as declarative
  fallback; filled slot content wins over any label prop.
- The docs-site Templates "Default content" section teaches fallback bodies,
  with the prop-conditional as an alternative pattern.
- Ships in the first minor after 0.4.0. The SPEC §24 amendment lands when
  this builds.

## Alternatives rejected

- **Prop-opt-in defaults as the permanent answer** — cannot express
  icon-as-default when the gating prop always has a value; pushes a
  framework-shaped problem onto every component author.
- **A public is-slot-filled probe instead of fallback bodies** — more API
  surface for the same need.
- **Fallback on named slots only (outlet excluded)** — would enforce a
  Slot/Children split the compiler keeps as one mechanism, and discards the
  empty-outlet case.
