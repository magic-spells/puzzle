---
name: Codegen emission and golden files
kind: unit
status: verified
framework: go test
connections:
  - COMPONENT-CODEGEN
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
  - FILE-CODEGEN-LOWER
  - FILE-CODEGEN-PRESETS
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
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DOC-COMPILATION-FLOW
  - DOC-TESTING
  - TEST-TODOS-INTEGRATION
verified_at: '2026-08-24T21:11:50.859Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Codegen emission and golden files

The byte-level emission contract, in `compiler/internal/codegen`. Run from
`packages/puzzle` with `go test ./compiler/internal/codegen`.

- **Golden pairs** in `codegen/testdata`: a `.pzl` input beside its expected
  JavaScript, compiled and byte-compared. Expression lowering
  ([[DECISION-D176-EXPRESSION-LANGUAGE]]) is pinned by `expr_methods`,
  `expr_handlers` and `formatter_chain` (nested library calls).
- **Focused tests:** `expr_test.go` (name resolution from the tree, arrow
  parameters, handler lowering, the `this` safety net, the handler/library
  collision warning); `core_semantics_test.go` (member guards, loose equality, a
  library call in every value position, `|` as a compile error in every header,
  one-way transformed form values, `.size` as an ordinary member);
  `row_facts_test.go` (D170 row facts); `markup_test.go`/`markup_call_test.go`
  (`raw`/`newline_to_br` placement); `presets_test.go` (literal date presets and
  zones, handler arguments included). Others cover handler caching, class-name
  extraction, attributes, conditional arity, loop identifiers and keys, list
  blocks and static caching, inline SVG, scoped styles, script collisions,
  module stamps, refs, reserved bindings, skeleton min-duration, raw blocks,
  display coercion, text-run whitespace, Portal roots, comments, and a11y.

- **D180:** `component_test.go` and the `component_slot` golden pin direct and indexed-map `is` expressions, ordinary default-slot emission, selector module bindings versus ordinary prop data scope, helper imports and reserved aliases, source-ordered spreads, ordinary forwarded `name`/`from` props, missing/non-expression `is` and user `Component` rename diagnostics. `TestComponentSelectorHygiene` pins live module getters for `__d`/`__f` and generated row-scope collisions while lexical template bindings retain precedence. The check emitter's JS/TS hygiene tests also pin remapped missing-property diagnostics. The check emitter and plugin have their own `component_test.go` for selector scope and `__PUZZLE_HAS_COMPONENT_SLOT__` usage detection.

**The Go and JS suites are coupled here.** The golden tests also compile the real
`examples/todos/app` sources and compare them with the committed fixtures under
`tests/fixtures/todos/` — the ones the vitest todos suite mounts
([[TEST-TODOS-INTEGRATION]]). A codegen change that alters todos emission fails
Go until the JS fixture is updated; that closes the loop between compiler output
and the runtime calling convention.

Regenerate goldens only deliberately, and review the diff:
`go test ./compiler/internal/codegen -update`.
