---
name: 'D141 — Marker fallback bodies'
status: verified
connections:
  - DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DOC-SPEC-TEMPLATE
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/viewManager.js
  - client-runtime/ssg/preload.js
  - compiler/internal/codegen/codegen.go:emitSlot
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
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
- **"Nothing fills the position" means nothing rendered.** A position is filled
  only when the content supplied for it renders at least one node that is not
  whitespace-only text ([[DECISION-D173-CORE-SEMANTICS]] V14). A false
  call-site `{#if}` and an empty `{#for}` both leave it unfilled, so the
  fallback shows — the empty-state pattern needs no extra syntax. The same test
  applies to each snippet stamp and to a forwarded position.
- **A fallback is lazy: neither evaluated nor built unless the position is
  unfilled.** Codegen emits the body as a thunk on the marker
  (`attrs.fallback: () => [ … ]`), not as its children, and the runtime `fill`
  calls it only for an unfilled position. A filled position — a snippet
  stamping every row of a VirtualList, or plain call-site content — never runs
  its fallback's expressions, formatters, or their development diagnostics (the
  D173 V6 value-printing warnings), and never allocates its vnodes. The thunk
  runs **at most once per marker vnode**: its result moves into the marker's
  otherwise empty `children` and the thunk is cleared (only after it returns,
  so a throwing body is retried on the next render), so a marker reused across
  renders (a clean [[DECISION-D170-INCREMENTAL-VDOM-LISTS]] row) hands back the
  same fallback vnodes and `patch()`'s identity short-circuit keeps them free.
  The thunk closes over the render scope it was built in; that is sound
  because a cached row is only reused while everything its body reads —
  fallback included, since the body is compiled in the row's scope — is
  unchanged, and a list block inside a deferred body treats the renders it
  missed as dirty. A hand-built marker may still carry an eager fallback as
  `children`; the runtime accepts both. Hybrid and static prerender share
  `expandSlots`, so prerendered output is lazy too.
- **A fallback that builds nothing is no fallback.** A body that evaluates to
  no nodes (a `{#for}` over an empty list) leaves the marker as if it were
  self-closing: the supplied nodes pass through, arity placeholders included,
  so a toggling call-site `{#if}` never shifts the siblings after the marker.
  This is the eager-era behavior, preserved; deciding it costs one evaluation
  of the body, which an unfilled position needs anyway.
- **Expansion failures are contained like render failures.** Because the body
  now runs during slot expansion rather than inside `render()`, every caller
  keeps expansion inside the same error boundary as `render()`: a view's render
  span (D145), the SSG serializer, and the takeover preload, where a throwing
  fallback marks that one component `takeoverFailed` and degrades it to a
  placeholder instead of rejecting navigation #0 or the static boot.
- **Keep a fallback to one root element when siblings follow the marker.** The
  unkeyed patcher pairs children by position, so a fallback whose node count
  differs from the content it swaps with shifts every sibling after the marker
  in the component's template, and those siblings remount on each flip (an
  input loses focus, a child component loses its state). A marker without a
  fallback passes its content through untouched and never shifts anything; the
  runtime does not pad fallbacks (measured at +32 B gzip and rejected).
- **A fallback body is ordinary template content.** Interpolations (including
  formatter pipes), `{#if}`/`{#for}`/`{#case}` blocks, components, event
  bindings, refs, and `{#svg}` inline SVG (D46) all parse and compile through
  the same paths as any element body — `emitSlot` runs the ordinary child
  emission in the enclosing scope and only wraps the resulting array in the
  thunk; nothing else is special-cased. A composition marker inside another
  marker's fallback body is a positioned compile error (no coherent expansion
  order; relaxable if a real case appears).
- **No public is-slot-filled probe.** The runtime's marker expansion knows
  whether a position was filled, which is all fallback needs. A testable-slots
  API remains a separate, unclaimed decision.
- **Implementation surface:** `Slot.Children` in the AST, paired-marker
  parsing, codegen's thunk emission in `emitSlot`, the runtime `fill` helper in
  `expandChildList` (the filled test runs only for a marker that has a
  fallback), the fail-soft expansion in `ssg/preload.js`, and fallback-content
  traversal in a11y, refs, and the class scan. Pinned by
  `tests/lazy-slot-fallback.test.js` (compiled fixtures in
  `tests/fixtures/lazy-fallback/`: the VirtualList row shape, plus argument-free
  markers filled by plain content and an empty loop fallback) and the
  `marker_fallbacks` golden.

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
- **An eager fallback: the body emitted as the marker's children** — built and
  evaluated on every render whether or not it showed. Beyond the wasted
  allocation, it ran the fallback's expressions for positions a snippet
  filled, so 0.8's value-printing check warned "object template value for
  row.item" on every VirtualList whose rows were snippet-stamped, for content
  that never renders. The thunk costs one closure per paired marker per built
  row, filled or not. Measured on build+expand of 1,000 rows: snippet-filled
  ~17% faster, every row showing its fallback ~5% slower, a clean cached row
  unchanged.
- **Silencing the diagnostics during fallback construction instead** — a flag
  around fallback evaluation would hide the warning but keep the wasted work,
  keep the side effects of fallback formatters, and would also suppress the
  warning in the case where the fallback DOES render and it is correct.
