---
name: "D9 — Compiler is Go + an esbuild `onLoad` plugin"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
---

# D9 — Compiler is Go + an esbuild `onLoad` plugin

Enforced by [[DOC-SPEC-ANATOMY]] §11.

## Decision
The compiler registers a `.pzl` plugin with esbuild's `api.Build`/`api.Context`: the Go side parses templates (the parser lives in `packages/puzzle-lang`) and generates render functions; esbuild owns module resolution, bundling, sourcemaps and minification. Compiled templates join the module graph, and the runtime ships as the npm package `@magic-spells/puzzle`, which esbuild resolves like any dependency.

## Why
esbuild is Go-native, so the compiler and bundler share one process and one module graph.

## Alternatives rejected
- Concatenating the runtime and compiled templates into output files (the prototype's `bundleRuntime()`) — orphan files outside the module graph.
