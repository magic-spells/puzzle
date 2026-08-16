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
  - DECISION-D131-DCE-ORACLE-ATTRIBUTION
  - DECISION-D148-PREVIEW-AND-STATIC-DEV
  - DECISION-D152-BUILD-SCOPED-COMPILE-CACHE
  - DECISION-D153-PUZZLE-SCRATCH-DIR
  - DECISION-D154-STATIC-DEV-WARM-REBUILDS
  - DECISION-D155-ROUTE-LEVEL-INVALIDATION
  - DECISION-D156-BUILD-PIPELINE-PERFORMANCE
  - DECISION-D160-SPA-CODE-SPLITTING
  - FEATURE-SPA-CODE-SPLITTING
  - FEATURE-BUILD-PIPELINE-PERFORMANCE-HARDENING
  - FEATURE-DEV-PROXY
  - FEATURE-SCOPED-STYLES
  - DOC-TESTING
---


# Build pipeline, watch, and dev server

Go integration tests over everything between a project directory and a `dist/`
folder, plus the long-running dev loop on top of it.

Build: option resolution, JavaScript config loading, import aliases, the esbuild
plugin's resolution and CSS collection, SVG assets, scoped styles, the
Tailwind-first style pipeline and its resolver, public asset copying with
case-insensitive collision refusal, atomic staging and swap so a failed build
preserves the last good output, working-directory handling, runtime env defines,
the prerender pass for both output modes, static page emission, route dependency
tracking, route head warnings, and the fixtures flag.

Caching and performance: the build-scoped compile cache with its eviction path,
the scan memo, the pass context, route-level invalidation, and the build profile
output.

Dev: change detection, the rebuild pipeline, warm static rebuilds, the local
server with SSE reload, port scanning when the requested port is taken, proxy
prefix validation, preview serving, and terminal UI rendering.

Watch behavior has both correctness tests and benchmark-shaped tests in the same
package; the benchmarks measure rebuild cost rather than asserting it, so they
are not a pass/fail gate on timing.

Covers 27 `*_test.go` files across `compiler/internal/{build,plugin,styles,config,fsutil,keys}`
and 7 more across `compiler/internal/{dev,serve,preview,ui}`.
