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
  - DECISION-D67-HYBRID-PRERENDER
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
  - DECISION-D179-STATIC-PATHS
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Hybrid and static prerender output

Both prerender modes ([[DOC-SPEC-BUILD]] §36) and the seam where the browser picks the
markup up. Run with
`npx vitest run tests/ssg tests/static-kernel tests/static-prerender tests/static-docs tests/prerender tests/route-tree-shared`
(a bare `tests/static` filter also pulls in the unrelated `static-cache*` DOM suites).

- **Serializer** (`ssg-serialize`, `ssg-rawtext`, `ssg-equivalence`): node-to-HTML
  emission, RAWTEXT elements, refs dropped, and the equivalence suite that renders one
  tree through the serializer and through [[COMPONENT-VIEW-MANAGER]] and demands they
  agree: the guard against the DOM-free path growing a second rendering dialect.
  `<Component>` selections (`component-slot`, D180) serialize with no visible wrapper.
- **Hybrid** (`output: 'hybrid'`; `ssg-prerender`, `ssg-router-takeover`,
  `prerender-router-base`): route prerender orchestration, router takeover at navigation
  zero, mount restoration over prerendered markup, the route snapshot that survives
  takeover, base-path hrefs matching `router.url()`, hash apps rejected.
- **Static** (`output: 'static'`; `static-kernel`, `static-prerender`,
  `static-docs-example`): the per-page `mountStatic` kernel and its router facade,
  base-prefixed page-module hrefs, hash and memory modes flattened or refused, storage
  ignored with a warning, and the route-subset render used by incremental rebuilds.
  `static-docs-example` runs a built `examples/static-docs` (pretest
  `build:static-docs`).
- **`staticPaths`** (D179): `static-prerender` covers the value forms and model
  shorthand, the build errors (missing or unservable values, non-array results, no
  `:param`, a parent route, a throwing function), duplicates, empty lists, encoding,
  fixed-route collisions, the hybrid `shadowed` skip and the subset re-list;
  `static-kernel` the island-to-`route.params` threading; `ssg-router-takeover` hybrid
  takeover of a generated page. Go: `static_pages_test.go` and `watch_static_test.go`.
- **D161 read state**: emission (the envelope island beside the record island, omitted
  for adapter-less and settled-nothing pages, script-breakout escaping, a rejected
  tracked fault failing the build naming the route, hybrid transferring nothing) and
  adoption (the kernel adopting the envelope, faulting normally without one, ignoring an
  empty or foreign-version envelope, surviving a corrupt one without losing records).
- **Build-time reads** (`ssg-build-fetch`): the prerender pass's global-`fetch` wrapper
  fails an app-relative endpoint with a diagnostic naming the URL and both fixes, and
  passes absolute URLs through.
- **Head management** (`ssg-head`): per-field leaf-to-root resolution and managed-tag
  surgery into both shells, before any JS. Head-tag injection is build-time only; the
  tests keep it that way.
- **Route tree** (`route-tree-shared`): a drift guard that SSG enumeration and the router
  table agree.

Locale prerendering is in [[TEST-I18N]]; the golden file
`tests/fixtures/prerender-golden/golden.json` pins every prerendered file.
