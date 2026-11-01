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
  - DECISION-D79-LINK-FUNCTION
  - DECISION-D83-QUERY-REPLACE
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D159-ROUTER-MODE-FACTORIES
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DOC-TESTING
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Router navigation, matching, and commit atomicity

The largest suite, guarding the sharpest invariant: navigation loads before it commits,
and URL, history, mounted tree, route snapshot, outgoing scroll save and reused-ancestor
state commit together or not at all. The machine it exercises is [[STATE-NAVIGATION]].
Run with `npx vitest run tests/router tests/route-tree-shared`.

- **Core** (`router`, `router-nested`, `router-constructor-throw`, `router-lazy`):
  initial navigation, commit ordering, cancellation under the monotonic token, nested
  chains (matching, prefix reuse, params-only chain refresh, ancestor re-render after a
  swap), failure and cancellation keeping the last good tree, constructor config
  rejection, `lazy()` route views.
- **`NavigationResult`** (`router-navigation-result`, D182): every outcome
  `push()`/`replace()` resolve: commit, block, supersession, not-found, error,
  `redirectedFrom`, `catchAll`; same-path pushes when idle and mid-flight; a duplicate
  push joining the in-flight promise.
- **Patterns** (`router-patterns`, `router-unicode`): regex metacharacters escaped in
  literal paths, a declared trailing slash insignificant, declaration-order shadow
  warnings, failure-safe param decode, non-ASCII literals held in encoded form.
- **Modes and base** (`router-hash`, `router-memory`, `router-base`,
  `router-shadow-links`): the three modes behind the mode factories, base path per mode,
  link interception (including inside shadow DOM), popstate, memory mode doing no
  document-level work.
- **URLs** (`router-url`): `router.url()` argument guarding, per-mode output, the `link`
  function.
- **Scroll, focus, fragments** (`router-scroll`, `router-focus`, `router-fragment-pop`):
  scroll defaults, config, anchors, sessionStorage persistence; focus and announcement on
  commit, tabindex hygiene, skip cases, a custom behavior; a same-document fragment pop
  settles in place with no load, focus move or announcement.
- **Head** (`router-head`): title sync at the commit point only; hybrid takeover leaves
  prerendered tags.
- **Guards and failure** (`router-guard-redirect-pop-url`, `router-failed-pop-url`,
  `router-leave-hook-failure`): guard redirects and failed pops repairing the URL, a
  throwing leave hook not leaking the incoming chain.
- **Reused ancestors** (`router-ancestor-transaction`,
  `router-prepared-commit-containment`, D146): overlapping prepares, conflicting-commit
  convergence, exception safety, the mid-gate scope fence.
- **`router.views` and `agent`** (`router-views`, D183): the frozen leaf list and the
  `agent` route field's resolution and dev checks.
- **Route tree** (`route-tree-shared`): SSG enumeration and the router table agree.

Transitions and morphs are [[TEST-TRANSITIONS-MORPH]]; locale prefixes are
[[TEST-I18N]]; real-browser history is [[TEST-BROWSER-SMOKE]].
