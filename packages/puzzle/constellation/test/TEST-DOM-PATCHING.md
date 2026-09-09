---
name: ViewManager DOM patching, events, and bindings
kind: unit
status: verified
framework: vitest
connections:
  - COMPONENT-VIEW-MANAGER
  - FILE-VIEW-MANAGER
  - FILE-VIEW-NODE
  - DECISION-D17-RENDER-FUNCTIONS-VDOM
  - DECISION-D18-PER-NODE-LISTENERS
  - DECISION-D38-EVENT-MODIFIERS
  - DECISION-D44-DOM-ISLANDS
  - DECISION-D45-BACKSPACE-DELETE-FILTERS
  - DECISION-D46-INLINE-SVG
  - DECISION-D58-LIST-KEYING
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D86-OUTSIDE-MODIFIER
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
  - DECISION-D143-MOUNT-THROW-OWNERSHIP
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - FEATURE-IMPLICIT-BINDING
  - FEATURE-VIRTUAL-SCROLLING
  - DOC-EVENTS
  - DOC-THIRD-PARTY-DOM
  - DOC-TESTING
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# ViewManager DOM patching, events, and bindings

The node-level contract of [[COMPONENT-VIEW-MANAGER]]: what the patcher does to
real DOM, and what it promises not to touch.

Covered guarantees:

- mount and patch of attributes, properties, and children; form bindings set as
  properties rather than attributes; controlled `select` values;
  conditional-arity placeholder padding so trailing siblings keep their slots.
- keyed reconciliation on type-preserving `(tag, key)` pairs, auto-key
  resolution including custom primary keys, and the null-key warning.
- component prop bailout — the shallow-equality boundary that decides whether a
  child re-renders at all.
- `island` freezing children after mount while its own attrs and listeners keep
  patching; inline SVG arriving as string children.
- per-node event listeners, `@event` modifiers, key filters, and the
  outside-click modifier including its portal awareness. Runtime key filters and
  the compiler's filter table are pinned to each other by a parity test — adding
  a filter to one side alone fails.
- implicit two-way binding across its arms: local state, record, plain object,
  and a primitive bind root, plus the coercion matrix and handler memoization.
- mount-failure ownership: a throwing enter hook leaves the mounted tree alone;
  first-mount failure recovery survives a same-turn parent re-render, a
  superseding refresh, and a router-preloaded replacement at the owned position.

The virtual-scroll example is an acceptance case here — it proves the DOM window
stays bounded while the backing list does not.

Covers 14 files under `tests/`. Several read compiled fixtures that
`npm run pretest` generates; a bare `npx vitest run` on a fresh clone fails
those lanes until it has been run once.
