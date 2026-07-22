---
name: Static generation runtime
status: verified
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ESBUILD-PLUGIN
  - DECISION-D67-SSG-STATIC-BUILD
  - FEATURE-V1-33-SSG
  - FILE-SSG-RUNTIME
  - FILE-SSG-SERIALIZER
  - FILE-BUILD-PRERENDER
verified_at: '2026-07-22T00:04:07.787Z'
verified_sha: c0d180a71fd57b8d715dd3f1726ccc66827517a3
---

# Static generation runtime

The `@magic-spells/puzzle/ssg` subpath turns the normal PuzzleApp config and compiled ViewNode trees into static HTML. `prerender()` is DOM/filesystem-free; `prerenderToDir()` writes output for the Go build's node-platform prerender bundle.

The orchestrator builds Store/Router/Formatter services, calls `beforeMount` with one `{ store, config }` facade as both receiver and argument, enumerates static route chains, preloads their layout/views, expands the routed slot cascade, resolves titles, and serializes the final tree. Static paths write directory-style `<path>/index.html`; a top-level catch-all writes `404.html`. Dynamic parameter/splat routes are skipped with warnings. Any `prerender: false` in a chain writes the plain SPA shell at that path.

The serializer mirrors ViewManager semantics: escaped text/attrs, controlled form initial state, inline components without wrappers, shared slot expansion, SVG string seeds verbatim, and framework attrs/events/keys/islands/refs omitted. Conditional placeholder vnodes serialize to nothing. Nested non-route components preload with `route: null`; pinned routed instances keep their route snapshot.

Shell injection requires an empty `#id` target, stamps `data-puzzle-ssg`, injects title/content, and containment-checks every output path. The browser router recognizes the marker at navigation zero, replaces prerendered children in its commit window, removes the marker, and skips the initial enter. No hydration protocol or SSR server is introduced.
