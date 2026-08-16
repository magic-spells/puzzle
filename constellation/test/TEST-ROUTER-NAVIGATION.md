---
name: Router navigation, matching, and commit atomicity
kind: integration
status: built
framework: vitest
connections:
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - FILE-ROUTE-TREE
  - FLOW-NAVIGATION
  - STATE-NAVIGATION
  - DOC-ROUTER
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D34-HASH-ROUTING
  - DECISION-D41-SCROLL-ANCHORS-PERSISTENCE
  - DECISION-D42-MEMORY-MODE
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D51-ROUTER-BASE-PATH
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D79-LINK-FORMATTER
  - DECISION-D83-QUERY-REPLACE
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - DECISION-D119-ROUTER-SETTLEMENT-ANNOUNCEMENT
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D159-ROUTER-MODE-FACTORIES
  - DOC-TESTING
---


# Router navigation, matching, and commit atomicity

The largest suite in the repository, and the one that guards the framework's
sharpest invariant: navigation loads before it commits, and URL, history,
mounted tree, route snapshot, outgoing scroll save, and reused-ancestor state
commit together or not at all.

Guarantees:

- initial navigation, commit ordering, cancellation under a monotonic token, and
  same-path pushes both idle and mid-flight.
- nested route chains: matching and composition, prefix reuse, params-only chain
  refresh, ancestor re-render after a swap, failure and cancellation leaving the
  last good tree intact, and constructor config rejection.
- pattern semantics: literal paths with regex metacharacters escaped, a declared
  trailing slash treated as insignificant, declaration-order shadow warnings,
  failure-safe param decode, and non-ASCII literal paths held in encoded
  pathname form.
- all three modes behind the mode factories — path routing as the inline
  default, hash, and memory — with base-path normalization per mode, link
  interception (including inside shadow DOM), popstate, and memory mode
  performing no document-level work at all.
- `Router.url()` argument guarding and per-mode output, plus the `link`
  formatter built on it.
- scroll behavior: defaults, configuration, anchor targets, sessionStorage
  persistence, and hash-mode anchors.
- focus and announcement on commit, tabindex hygiene, skip cases, disabling, and
  a custom behavior.
- head sync at the commit point and nothing else, with hybrid takeover leaving
  prerendered tags intact.
- route guards, a throwing leave hook not leaking the incoming chain, and the
  transactional reused-ancestor prepare/commit including overlapping prepares,
  conflicting-commit convergence, exception safety, and the mid-gate scope fence.
- the shared route-tree helpers, with a drift guard asserting SSG enumeration and
  the router table stay in agreement.

Covers 15 files under `tests/`.
