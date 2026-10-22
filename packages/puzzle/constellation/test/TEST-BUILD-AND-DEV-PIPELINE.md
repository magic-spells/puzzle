---
name: Build pipeline, watch, and dev server
kind: integration
status: built
framework: go test
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-DEV-SERVER
  - FILE-BUILD
  - FILE-BUILD-OPTIONS
  - FILE-BUILD-WATCH
  - FILE-BUILD-PRERENDER
  - FILE-BUILD-PRERENDER-PAGES
  - FILE-ESBUILD-PLUGIN
  - FILE-CONFIG
  - FILE-STYLES
  - FILE-STYLES-WATCH
  - FILE-DEV-SERVER
  - FLOW-BUILD
  - FLOW-DEV-REBUILD
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D12-TAILWIND-FIRST
  - DECISION-D26-TAILWIND-PIPELINE
  - DECISION-D27-FAST-DEV-REBUILDS
  - DECISION-D75-IMPORT-ALIAS
  - DECISION-D88-SOURCEMAP-OPT-OUT
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D90-DEV-PORT-SCAN
  - DECISION-D92-DEV-ERROR-OVERLAY
  - DECISION-D110-DEV-PROXY-PREFIX-VALIDATION
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - DECISION-D153-PUZZLE-SCRATCH-DIR
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D156-BUILD-PIPELINE-PERFORMANCE
  - DECISION-D160-SPA-CODE-SPLITTING
  - DECISION-D59-SCOPED-STYLES
  - FEATURE-DEV-PROXY
  - DOC-TESTING
  - DECISION-D181-HASHED-OUTPUT-NAMES-AND-MODULEPRELOAD
---

# Build pipeline, watch, and dev server

Go integration tests over everything between a project directory and `dist/`,
plus the long-running dev loop on top of it. Packages:
`compiler/internal/{build,plugin,styles,config,locales,fsutil,keys}` and
`compiler/internal/{dev,serve,preview,ui}`. Run from `packages/puzzle` with
`go test ./compiler/internal/...`.

- **Build:** option resolution, JavaScript config loading, import aliases, the
  esbuild plugin's resolution and CSS collection, SVG assets, scoped styles, the
  Tailwind-first style pipeline and its resolver, public asset copying with
  case-insensitive collision refusal, atomic staging and swap (a failed build
  keeps the last good output), working-directory handling, runtime env defines,
  both prerender passes, static page emission, route dependency tracking, route
  head warnings, SPA code splitting and chunk pruning, locale files, and the
  fixtures flag.
- **Caching and performance:** the build-scoped compile cache and its eviction,
  the scan memo, the pass context, route-level invalidation, and the build
  profile output.
- **Dev:** change detection, the rebuild pipeline, warm static rebuilds, the
  local server with SSE reload, port scanning, proxy prefix validation, preview
  serving, and terminal UI rendering.

Watch tests include benchmark-shaped cases that measure rebuild cost; they are
not a pass/fail timing gate.

Production asset coverage spans shell_test.go and build/prerender/static_pages
integration tests: exact local reference spellings, quoting/query/fragment
preservation, credentials and indentation, metafile static BFS order/diamonds/external
and dynamic exclusions, cwd/staging keys and symlink spelling, deterministic entry/CSS
names, unlinked stylesheets, imported CSS, opt-in/opt-out/default config, and
failure-before-swap. Unrecognized unhashed shell entries skip preloads, and
non-missing shell read errors report their I/O cause. The preload integration
assertion identifies the fixture's expected shared chunk directly; source-map and
determinism checks have separate tests. Hybrid shells/pages and every static locale
page inherit the
emitted URLs; default static output keeps names and gains preloads. Development byte
stability and the warm watch suites remain covered. Preview recognizes hashed app
entries; the JS static-docs acceptance test checks production preloads without
changing the prerender summary contract.

`shell_base_test.go` builds SPA, hybrid and static output under single- and multi-segment deployment prefixes, including every locale page and 404. Emitted CSS/JS/preload targets exist, copied public scripts stay unchanged, static output drops the discarded app script, and a missing compiler stylesheet fails before replacing dist.
