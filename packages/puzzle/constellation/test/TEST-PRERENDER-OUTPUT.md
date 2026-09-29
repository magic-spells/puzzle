---
name: Hybrid and static prerender output
kind: integration
status: verified
framework: vitest
connections:
  - COMPONENT-SSG
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - FILE-SSG-SERIALIZER
  - FILE-SSG-ASSEMBLE
  - FILE-SSG-RUNTIME
  - FILE-STATIC-MOUNT
  - FILE-HEAD-TAGS
  - FILE-ROUTE-TREE
  - FLOW-PRERENDER
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D113-SSG-RAWTEXT-RULE
  - DECISION-D130-TAKEOVER-BUILD-DEFINE
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
  - DECISION-D142-HYBRID-ROUTE-SNAPSHOT
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DOC-SPEC-BUILD
  - DOC-TESTING
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Hybrid and static prerender output

Both prerender modes ([[DOC-SPEC-BUILD]] §36) and the seam where the browser
picks the markup up. Suites under `tests/`: `ssg-*`, `static-kernel`,
`static-prerender`, `static-locale-remount`, `prerender-router-base`,
`route-tree-shared`. Run with `npx vitest run tests/ssg tests/static tests/prerender`.

- **Serializer:** node-to-HTML emission, RAWTEXT elements, refs dropped, and the
  equivalence suite that renders one tree through the serializer and through
  [[COMPONENT-VIEW-MANAGER]] and demands they agree — the real guard against the
  DOM-free path growing a second rendering dialect.
- **Hybrid** (`output: 'hybrid'`): route prerender orchestration, router takeover
  at navigation zero, mount restoration over prerendered markup, the route
  snapshot that survives takeover, base-path hrefs matching `Router.url()`, and
  hash apps rejected.
- **Static** (`output: 'static'`): the per-page `mountStatic` kernel, its router
  facade, base-prefixed page-module hrefs, hash and memory modes flattened or
  refused, storage ignored with a warning, and the route-subset render used by
  incremental rebuilds.
- **D161 read state**, both sides. Emission: the envelope island beside the
  record island, omitted for adapter-less and settled-nothing pages,
  script-breakout escaping, a rejected tracked fault failing the build naming the
  route, hybrid transferring nothing. Adoption: the kernel adopting the envelope,
  faulting normally without one, ignoring an empty or foreign-version envelope,
  dropping an absence whose record rode the data island, and surviving a corrupt
  envelope without losing records.
- **Build-time reads:** the prerender pass's global-`fetch` wrapper fails an
  app-relative endpoint with a diagnostic naming the URL and both fixes, and
  passes absolute URLs through.
- **Head management:** per-field leaf-to-root resolution and managed-tag surgery
  into both shells, landing before any JS. Head-tag injection is build-time only;
  the tests keep it that way.
