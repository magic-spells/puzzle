---
name: Playground WASM build and Node smoke
kind: integration
status: verified
framework: Node + Go toolchain
connections:
  - DECISION-D164-PLAYGROUND-WASM-BOUNDARY
  - COMPONENT-PLAYGROUND-COMPILER
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - FILE-PZL-WASM
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Playground WASM build and Node smoke

The in-browser compiler boundary ([[DECISION-D164-PLAYGROUND-WASM-BOUNDARY]],
[[FILE-PZL-WASM]]). Run from `packages/puzzle`:
`node scripts/build-wasm.mjs && node scripts/smoke-wasm.mjs`.

- **`scripts/build-wasm.mjs`** pins size and dependencies: it asserts the `GOOS=js`
  dependency graph has no esbuild package, builds the module, copies the matching
  toolchain `wasm_exec.js`, and fails over a 6 MiB raw ceiling.
- **`scripts/smoke-wasm.mjs`** owns the executable API contract. It loads the module in
  Node and checks: the canonical todos view compiles; a broken source reports a
  positioned error; `{#svg}` is rejected at its path literal; a styled component returns
  its CSS plain and `scoped` (the `@scope` id matching the `data-<scopeId>` stamp in the
  JS); an over-deep and an over-long source, and a throwing `options` getter, each answer
  with a diagnostic and leave the instance able to compile again. It ends by timing 50
  compiles.
- **Go side**: `TestOverNestingDepth*` in `packages/puzzle-lang/parser/depth_test.go`,
  plus a CI step that builds `./compiler/cmd/pzl-wasm` for `GOOS=js GOARCH=wasm`.

Gotcha: `cmd/pzl-wasm` sits behind a `js && wasm` build tag, so `go build ./...` and
`go vet ./...` never compile it; only the CI step (or `build-wasm.mjs`) catches a break.
