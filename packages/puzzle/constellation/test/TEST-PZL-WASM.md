---
name: playground WASM build and Node smoke
kind: integration
status: built
framework: Node + Go toolchain
code_refs:
  - scripts/build-wasm.mjs
  - scripts/smoke-wasm.mjs
connections:
  - DECISION-D164-PLAYGROUND-WASM-BOUNDARY
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
---

Build-level checks pin the size/dependency boundary; the Node smoke loads the produced module, compiles the canonical todos view, validates positioned errors, and times 50 repeated compiles.
