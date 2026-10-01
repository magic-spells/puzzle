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
verified_at: '2026-09-27T00:25:55.351Z'
verified_sha: 3957beaf4eb72e0fe9fb06853a96761b66a209b8
code_refs:
  - client-runtime/views/viewManager.js
  - client-runtime/ssg/preload.js
  - compiler/internal/codegen/codegen.go:emitSlot
---

## Context

Components need default content that a caller can replace — stock trigger
chrome unless the caller supplies its own (the standard slot contract in Vue,
web components, Astro, Angular). Prop-conditionals cannot express it when the
gating prop always has a value (an emoji picker's `label` is its aria-label).

## Decision

Paired composition markers carry a fallback body — `<Children>…</Children>`,
`<Slot name="x">…</Slot>`, `<Slot>…</Slot>`. The fallback renders only when
nothing fills that position; supplied content (call site or router) replaces it
entirely. Self-closing markers and empty paired bodies have no fallback.

- **One mechanism.** `<Children>` and bare `<Slot>` are the same AST node, so
  fallback works identically for default content, named slots, and the router
  outlet (shown when no child route occupies it).
- **"Filled" means rendered.** A position is filled only when its content
  renders at least one node that is not whitespace-only text
  ([[DECISION-D173-CORE-SEMANTICS]] V14). A false `{#if}` or empty `{#for}` at
  the call site shows the fallback. The same test applies per snippet stamp and
  to forwarded positions.
- **Lazy.** Codegen (`emitSlot`) emits the body as a thunk,
  `attrs.fallback: () => [ … ]`, compiled in the enclosing scope; the runtime
  `fill` in `expandChildList` calls it only for an unfilled position. A filled
  position never evaluates its fallback's expressions or dev diagnostics and
  never allocates its vnodes. The thunk runs at most once per marker vnode: the
  result moves into the marker's `children` and the thunk is cleared after it
  returns (a throwing body retries next render), so a reused marker (a clean
  [[DECISION-D170-INCREMENTAL-VDOM-LISTS]] row) hands back the same vnodes. A
  hand-built marker may carry an eager fallback as `children`. Hybrid and
  static prerender share `expandSlots`.
- **A fallback that builds nothing is no fallback.** The marker then passes the
  supplied nodes through, arity placeholders included, so a toggling call-site
  `{#if}` never shifts later siblings.
- **Expansion failures are render failures.** Every caller keeps slot
  expansion inside its render error boundary: a view's render span (D145), the
  SSG serializer, and the takeover preload, where a throwing fallback marks
  that component `takeoverFailed` and degrades it to a placeholder.
- **A fallback body is ordinary template content** — interpolations, blocks,
  components, events, refs, `{#svg}`. A composition marker (or `<Portal>`)
  inside a fallback body is a positioned compile error.
- **Marker spelling.** Markers are capitalized; lowercase `<children>`,
  `<slot>`, `<portal>` outside `{#raw}` are positioned steering errors.
- Pinned by `tests/lazy-slot-fallback.test.js` (fixtures in
  `tests/fixtures/lazy-fallback/`) and the `marker_fallbacks` codegen golden.

## Alternatives

- Prop-opt-in defaults only — cannot express icon-as-default when the gating
  prop always has a value.
- A public is-slot-filled probe — more API for the same need; still unclaimed.
- Fallback on named slots only — would split the one Slot/Children mechanism
  and lose the empty-outlet case.
- Eager fallback (body as the marker's children) — evaluated on every render,
  and its value-printing warnings fired for snippet-filled VirtualList rows
  whose fallback never renders. Lazy: snippet-filled rows ~17% faster,
  fallback-showing rows ~5% slower (1,000-row build+expand).
- Silencing diagnostics during fallback construction — keeps the wasted work
  and hides real warnings when the fallback does render.

## Consequences

- Keep a fallback to one root element when siblings follow the marker: the
  unkeyed patcher pairs by position, so a node-count mismatch shifts and
  remounts later siblings on each flip. The runtime does not pad (+32 B gzip,
  rejected).
- Registry pieces (Popconfirm, EmojiPicker, DropdownMenu trigger, Dialog, …)
  express stock chrome as fallback; filled content wins over any label prop.
