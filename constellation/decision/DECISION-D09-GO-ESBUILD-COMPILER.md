---
name: "D9 — Compiler is Go + an esbuild `onLoad` plugin"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
verified_sha: 95cc18ec36d881132ee5c43e9288ceeb00b31fd2
connections:
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-COMPILER-DESIGN
  - DOC-SPEC
---

# D9 — Compiler is Go + an esbuild `onLoad` plugin

Settled per [[DOC-SPEC]] §11. The compiler registers a `.pzl` esbuild plugin with `api.Build`: Go parses templates and generates render functions; esbuild owns bundling, resolution, sourcemaps, and minification.

## Context
esbuild is Go-native, which makes it a natural fit for a Go-based compiler. The prototype used a `bundleRuntime()` concatenation approach that produced orphan output files.

## Decision
The compiler registers a `.pzl` plugin with `api.Build`: the Go side parses templates and generates render functions; esbuild owns module resolution, bundling, sourcemaps, and minification.

## Alternatives rejected
- The prototype's `bundleRuntime()` concatenation approach — deleted; compiled templates join the module graph instead of being orphan output files.

## Consequences
Compiled templates join the module graph instead of being orphan output files; the runtime ships as a normal npm package (`@magic-spells/puzzle`) that esbuild resolves.
