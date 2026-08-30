---
name: Playground WASM compiler
status: built
connections:
  - FEATURE-PLAYGROUND-WASM-COMPILER
  - DECISION-D164-PLAYGROUND-WASM-BOUNDARY
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - FILE-PZL-WASM
  - TEST-PZL-WASM
---

# Playground WASM compiler

A js/wasm-only bridge over the real section splitter, template parser, and render-function code generator. It registers two synchronous globals and then keeps the Go runtime alive:

- `__pzlCompile(source, options)` returns `{ js, warnings, errors }`; every diagnostic is `{ message, line, col }`, and errors are returned rather than thrown.
- `options.filename` defaults to `app/views/Playground.pzl` and drives `ModeForPath`; `options.ts` is pinned for the worker protocol but reports the Phase 1 no-transform diagnostic.
- `__pzlVersion()` returns the framework compiler version.

The command passes `AssetReadsUnavailable` into codegen, so `{#svg}` fails at the path literal before `filepath`/`SVGCache` can reach `os.ReadFile`. The only build artifact in this phase is local and ignored: `artifacts/wasm/{pzl.wasm,wasm_exec.js}`.

The build script proves the command's dependency graph contains no esbuild package, uses the matching Go toolchain's runtime shim, enforces a 6 MiB raw ceiling, and reports raw/gzip bytes. The Node smoke owns the executable API contract until the Phase 2 worker exists.
