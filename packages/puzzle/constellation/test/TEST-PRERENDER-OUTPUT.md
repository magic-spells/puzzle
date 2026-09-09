---
name: Hybrid and static prerender output
kind: integration
status: verified
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
  - DECISION-D161-AUTO-FETCHING-FINDS
  - FEATURE-V1-33-SSG
  - FEATURE-V1-47-STATIC-PAGES
  - DOC-TESTING
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
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

The D161 read-state seam is covered from both sides. Emission: the envelope
island beside the record island, its omission for adapter-less and
settled-nothing pages, script-breakout escaping, a rejected tracked fault
failing the build naming the route, and hybrid transferring nothing. Adoption:
the kernel adopting the envelope, faulting normally without one, ignoring an
empty or foreign-version envelope, dropping an absence whose record rode the
data island, and surviving a corrupt envelope without losing records.

Build-time reads: the prerender pass's global-`fetch` wrapper, which fails an
app-relative endpoint with a diagnostic naming the URL and both fixes instead of
a bare parse error, and passes absolute URLs through.

Head management: per-field leaf-to-root resolution, managed head surgery into
both the hybrid shell and the static shell, and head tags landing before any JS
in the emitted output. Head tag injection is build-time only — there is no
runtime consumer, and the tests are written to keep it that way.

Covers 10 files under `tests/`.
