---
name: playground WASM build and Node smoke
kind: integration
status: built
framework: Node + Go toolchain
connections:
  - DECISION-D164-PLAYGROUND-WASM-BOUNDARY
  - COMPONENT-PLAYGROUND-COMPILER
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - FILE-PZL-WASM
  - FEATURE-PLAYGROUND-WASM-COMPILER
---

`scripts/build-wasm.mjs` pins the size and dependency boundary: it asserts the
`GOOS=js` dependency graph contains no esbuild package, builds the module, copies
the matching toolchain `wasm_exec.js`, and fails over a 6 MiB raw ceiling.

`scripts/smoke-wasm.mjs` owns the executable API contract until the Phase 2
worker exists. It loads the produced module in Node and checks: the canonical
todos view compiles; a broken source reports a positioned error; `{#svg}` is
rejected at its path literal; a styled component returns its CSS both plain and
`scoped` (with the `@scope` id matching the `data-<scopeId>` stamp in the emitted
JS); an over-deep and an over-long source each answer with a diagnostic AND leave
the instance able to compile again; a throwing `options` getter does the same. It
closes by timing 50 repeated compiles.

The Go side of the same boundary is covered by `TestOverNestingDepth*` in
`compiler/internal/parser/depth_test.go` — a native test, so CI runs the depth
scan on every push — and by a CI step that builds the command under
`GOOS=js GOARCH=wasm`, which the `js && wasm` build tag otherwise hides from
`go build ./...`.
