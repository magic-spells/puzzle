---
name: In-browser playground Phase 1 — WASM compiler
status: building
change: feature
branch: feat/playground-wasm
connections:
  - DECISION-D164-PLAYGROUND-WASM-BOUNDARY
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-COMPILER-CLI
  - FILE-PZL-WASM
  - TEST-PZL-WASM
---

# In-browser playground Phase 1 — WASM compiler

Ship the parser + render-function code generator as a small Go WebAssembly module so a later web worker can compile one in-memory `.pzl` source without the CLI, esbuild, or a filesystem.

## Scope

- A js/wasm-only compiler entry exposes synchronous `__pzlCompile` and `__pzlVersion` globals.
- The build copies Go's matching `wasm_exec.js`, enforces an esbuild-free dependency graph and a 6 MB raw ceiling, and reports raw/gzip size.
- Filesystem-backed `{#svg}` is rejected at its source position with playground-specific guidance.
- A zero-dependency Node smoke compiles the canonical todos view, checks a positioned failure, and measures 50 compiles.
- The future worker request/result envelope is pinned in the entry's package documentation.

## Acceptance

- The WASM build and smoke scripts pass.
- Native `go build ./...`, `go vet ./...`, and parser/codegen tests stay green.
- `go list -deps` for the WASM command contains no `github.com/evanw/esbuild` package.
