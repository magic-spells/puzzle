---
name: Playground WASM build and Node smoke
kind: integration
status: built
framework: Node + Go toolchain
connections:
  - DECISION-D164-PLAYGROUND-WASM-BOUNDARY
  - COMPONENT-PLAYGROUND-COMPILER
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - FILE-PZL-WASM
---

# Playground WASM build and Node smoke

The in-browser compiler boundary ([[DECISION-D164-PLAYGROUND-WASM-BOUNDARY]],
[[FILE-PZL-WASM]]).

- **`scripts/build-wasm.mjs`** pins size and dependencies: it asserts the
  `GOOS=js` dependency graph has no esbuild package, builds the module, copies the
  matching toolchain `wasm_exec.js`, and fails over a 6 MiB raw ceiling.
- **`scripts/smoke-wasm.mjs`** owns the executable API contract until the worker
  exists. It loads the module in Node and checks: the canonical todos view
  compiles; a broken source reports a positioned error; `{#svg}` is rejected at its
  path literal; a styled component returns its CSS plain and `scoped` (the `@scope`
  id matching the `data-<scopeId>` stamp in the JS); an over-deep and an over-long
  source each answer with a diagnostic AND leave the instance able to compile
  again; a throwing `options` getter does the same. It ends by timing 50 compiles.
- **Go side:** `TestOverNestingDepth*` in `packages/puzzle-lang/parser/depth_test.go`,
  plus a CI step that builds `./compiler/cmd/pzl-wasm` under
  `GOOS=js GOARCH=wasm` — the `js && wasm` build tag hides it from
  `go build ./...`.

Run: `node scripts/build-wasm.mjs && node scripts/smoke-wasm.mjs` from
`packages/puzzle`.
