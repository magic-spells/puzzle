---
name: Build pipeline, watch, and dev server
kind: integration
status: verified
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
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Build pipeline, watch, and dev server

Go integration tests over everything between a project directory and `dist/`, plus the
dev loop on top of it. Packages: `compiler/internal/{build,plugin,styles,config,locales,fsutil,keys}`
and `compiler/internal/{dev,serve,preview,ui}`. Run from `packages/puzzle` with
`go test ./compiler/internal/...`.

- **Build** (`internal/build`): option resolution, JavaScript config loading, import
  aliases, the esbuild plugin's resolution and CSS collection, SVG assets, scoped styles,
  the Tailwind pipeline, public asset copying with case-insensitive collision refusal,
  atomic staging and swap (a failed build keeps the last good output), runtime env
  defines (`TestBuildDevDefineDCE` proves dev-only modules are erased), both prerender
  passes, static page emission, route dependency tracking, route head warnings, SPA code
  splitting and chunk pruning, locale files, the fixtures flag, and `.pzl` files read
  from installed packages (`package_pzl_test.go`).
- **Hashed names and preloads** (D181): `shell_test.go` and `shell_base_test.go` build
  SPA, hybrid and static output, including under single- and multi-segment deploy
  prefixes and every locale page and 404. They pin deterministic content-hashed
  entry/CSS/page names, `build.hashNames` on, off and default, modulepreloads in static
  BFS order (diamonds, externals and dynamic imports excluded), that every emitted
  CSS/JS/preload target exists, that copied public scripts stay byte-identical, and that
  a missing stylesheet fails before `dist/` is replaced. Development output stays
  unhashed.
- **Caching and performance**: the build-scoped compile cache and its eviction, the scan
  memo, the pass context, route-level invalidation, the build profile output.
- **Dev**: change detection, the rebuild pipeline, warm static rebuilds, the local server
  with SSE reload, port scanning, proxy prefix validation, preview serving (it recognizes
  hashed entries), and terminal UI rendering.

Gotchas: `watch_bench_test.go` and `watch_static_bench_test.go` measure rebuild cost
but are not a pass/fail timing gate. Multi-tab dev reload is a browser concern, covered
by `dev-reload` in [[TEST-BROWSER-SMOKE]].
