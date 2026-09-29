---
name: Router navigation, matching, and commit atomicity
kind: integration
status: verified
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
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D159-ROUTER-MODE-FACTORIES
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DOC-TESTING
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Router navigation, matching, and commit atomicity

The largest suite, guarding the sharpest invariant: navigation loads before it
commits, and URL, history, mounted tree, route snapshot, outgoing scroll save,
and reused-ancestor state commit together or not at all. Suites:
`tests/router*.test.js` and `route-tree-shared`. Run with
`npx vitest run tests/router`.

- initial navigation, commit ordering, cancellation under a monotonic token, and
  same-path pushes idle and mid-flight.
- nested chains: matching and composition, prefix reuse, params-only chain
  refresh, ancestor re-render after a swap, failure and cancellation keeping the
  last good tree, constructor config rejection; lazy route views.
- patterns: literal paths with regex metacharacters escaped, a declared trailing
  slash insignificant, declaration-order shadow warnings, failure-safe param
  decode, non-ASCII literal paths held in encoded pathname form.
- all three modes behind the mode factories (path inline, hash, memory), base
  path per mode, link interception (including inside shadow DOM), popstate, and
  memory mode doing no document-level work.
- `Router.url()` argument guarding and per-mode output, and the `link` function.
- scroll: defaults, config, anchor targets, sessionStorage persistence, hash-mode
  anchors. Focus and announcement on commit, tabindex hygiene, skip cases,
  disabling, a custom behavior.
- a same-document fragment pop settles in place — path/pathname/query/hash move
  and a saved position restores, with no load, focus move or announcement.
- head sync at the commit point only; hybrid takeover leaves prerendered tags.
- guards (including redirect-on-pop URLs), a throwing leave hook not leaking the
  incoming chain, and the transactional reused-ancestor prepare/commit:
  overlapping prepares, conflicting-commit convergence, exception safety, the
  mid-gate scope fence.
- the shared route-tree helpers, with a drift guard asserting SSG enumeration and
  the router table agree.
