---
name: Hybrid and static prerender output
kind: integration
status: built
framework: vitest
connections:
  - COMPONENT-SSG
  - FILE-SSG-SERIALIZER
  - FILE-SSG-ASSEMBLE
  - FILE-SSG-RUNTIME
  - FILE-STATIC-MOUNT
  - FILE-HEAD-TAGS
  - FLOW-PRERENDER
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D81-STATIC-PAGES-MODE
  - DECISION-D111-MANAGED-HEAD-BUILD-TIME-ONLY
  - DECISION-D113-SSG-RAWTEXT-RULE
  - DECISION-D117-STATIC-OUTPUT-HISTORY-HREFS
  - DECISION-D130-TAKEOVER-BUILD-DEFINE
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
  - DECISION-D142-HYBRID-ROUTE-SNAPSHOT
  - DECISION-D151-SHELL-HEAD-OWNERSHIP
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - FEATURE-V1-33-SSG
  - FEATURE-V1-47-STATIC-PAGES
  - DOC-TESTING
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
---

# Hybrid and static prerender output

Covers both prerender modes and the seam where the browser picks the markup up.

Serializer: node-to-HTML emission, RAWTEXT element handling, refs dropped, and
an equivalence suite that renders the same tree through the serializer and
through [[COMPONENT-VIEW-MANAGER]] and demands they agree. That equivalence test
is the real guard — it is what stops the DOM-free path from quietly growing a
second rendering dialect.

Hybrid (`output: 'hybrid'`): route prerender orchestration, router takeover at
navigation zero, mount restoration over prerendered markup, the route snapshot
that survives takeover, base-path handling in emitted hrefs with parity against
`Router.url()`, and the rejection of hash apps.

Static (`output: 'static'`): the per-page `mountStatic` kernel, the router facade
parity it presents to view code that expects a router, base-prefixed page module
hrefs, hash and memory modes flattened or refused, storage ignored with a
warning, and the route-subset render used by incremental rebuilds.

Head management: per-field leaf-to-root resolution, managed head surgery into
both the hybrid shell and the static shell, and head tags landing before any JS
in the emitted output. Head tag injection is build-time only — there is no
runtime consumer, and the tests are written to keep it that way.

Covers 9 files under `tests/`.
