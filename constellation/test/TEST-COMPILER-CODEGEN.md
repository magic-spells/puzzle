---
name: Codegen emission and golden files
kind: unit
status: built
framework: go test
connections:
  - COMPONENT-CODEGEN
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
  - FILE-PZLC
  - FILE-TESTS-FIXTURES-TODOS-HOME-COMPILED
  - FILE-TESTS-FIXTURES-TODOS-DEFAULT-COMPILED
  - DECISION-D10-PROTOTYPE-RENDER
  - DECISION-D17-RENDER-FUNCTIONS-VDOM
  - DECISION-D24-CLASS-NAME-EXTRACTION
  - DECISION-D29-LOOP-COUNTER
  - DECISION-D58-LIST-KEYING
  - DECISION-D59-SCOPED-STYLES
  - DECISION-D62-HANDLER-CACHING
  - DECISION-D82-A11Y-WARNINGS
  - DECISION-D127-DISPLAY-COERCION-OWNER
  - DECISION-D133-RESERVED-SCRIPT-BINDINGS
  - DECISION-D144-PORTAL
  - DECISION-D147-IMPLICIT-TWO-WAY-BINDING
  - DECISION-D150-RAW-TEMPLATE-BLOCK
  - DOC-COMPILATION-FLOW
  - DOC-TESTING
  - TEST-TODOS-INTEGRATION
---


# Codegen emission and golden files

The byte-level emission contract. Per-construct golden pairs live in
`compiler/internal/codegen/testdata` as a `.pzl` input beside its expected
JavaScript, compiled and byte-compared.

Beyond the goldens, focused tests cover expression scoping, event handler
emission and handler caching, class-name extraction, empty and boolean
attributes, conditional arity stabilization, loop item identifiers and range
parens, list keys, inline SVG with its cache and dedup, scoped styles, script
name collisions, module stamping, refs, reserved script bindings, skeleton
minimum duration, the raw block, display coercion, Portal at a component root,
template comments, and a11y warnings.

**The two suites are coupled here.** The golden tests also compile the real
`examples/todos/app` sources and compare them against the committed JavaScript
fixtures under `tests/fixtures/todos/` — the same fixtures the vitest todos
suite mounts. A codegen change that alters todos emission fails the Go suite
until the JS fixture is updated, which is the intended coupling: it closes the
loop between compiler output and the runtime calling convention.

Regenerate goldens only deliberately and review the diff:

```sh
go test ./internal/codegen -update
```

Covers 25 `*_test.go` files under `compiler/internal/codegen`.
