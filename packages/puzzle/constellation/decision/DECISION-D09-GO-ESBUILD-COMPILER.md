---
name: "D9 — Compiler is Go + an esbuild `onLoad` plugin"
status: verified
verified_at: '2026-11-01T19:19:59.201Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D9 — Compiler is Go + an esbuild `onLoad` plugin

Enforced by [[DOC-SPEC-ANATOMY]] §11. esbuild is Go-native, so the compiler and bundler share one process and one module graph.

## Decision
- The compiler registers a `.pzl` plugin with esbuild's `api.Build`/`api.Context`. The Go side parses templates (the parser lives in `packages/puzzle-lang`) and generates render functions; esbuild owns module resolution, bundling, sourcemaps and minification.
- Compiled templates join the module graph. The runtime ships as the npm package `@magic-spells/puzzle`, which esbuild resolves like any dependency.

## Alternatives rejected
- Concatenating the runtime and compiled templates into output files — orphan files outside the module graph.
