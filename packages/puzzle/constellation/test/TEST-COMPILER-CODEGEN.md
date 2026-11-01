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
  - DOC-COMPILER-DESIGN
  - DOC-TESTING
  - TEST-TODOS-INTEGRATION
  - DECISION-D173-CORE-SEMANTICS
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Codegen emission and golden files

The byte-level emission contract of `compiler/internal/codegen`. Run from
`packages/puzzle` with `go test ./compiler/internal/codegen`. The parser's own tests
live in `packages/puzzle-lang` (run `go test ./...` there; this package's run does not
reach them).

- **Golden pairs** in `codegen/testdata`: a `.pzl` input beside its expected JavaScript,
  compiled and byte-compared. Expression lowering (D176) is pinned by `expr_methods`,
  `expr_handlers` and `formatter_chain`; `<Component>` (D180) by `component_slot` and
  `component_slot_lists`.
- **Focused tests**, one file per concern: `expr_test.go` (name resolution, arrow
  parameters, handler lowering, the `this` safety net, the handler/library collision
  warning); `core_semantics_test.go` (D173 member guards, loose equality, a library call
  in every value position, `|` as a compile error in every header, `.size` as an ordinary
  member); `row_facts_test.go`, `listblock_test.go` and `static_cache_test.go` (D170);
  `markup_test.go`/`markup_call_test.go` (`raw`/`newline_to_br` placement);
  `presets_test.go` (literal date presets and zones); `url_test.go` (D186 dynamic URL
  bindings); `component_test.go` and `binding_scope_test.go` (D180 `is` scope: module
  bindings and imports for `is`, data scope for every other prop, loop-local precedence,
  ASI-terminated declarators, generated-name hygiene, positioned errors for a
  missing/non-expression `is` and for `flip`, the reserved `Component` name). The rest
  are named for what they pin: handler caching, class names, attributes, conditional
  arity, loop keys, inline SVG, scoped styles, script collisions, module stamps, refs,
  reserved bindings, skeleton min-duration, raw blocks, display coercion, text-run
  whitespace, Portal roots, comments, a11y.
- **JS lane over compiled fixtures**: `tests/core-semantics.test.js` (D173 runtime
  semantics of compiled output) and `tests/handler-this.test.js` (a non-arrow handler
  using `this`, JS and TS) mount fixtures that `npm run pretest` compiles with `pzlc`.
- `puzzle check`'s emitter has its own `internal/check/component_test.go` for selector
  scope, including a live-`tsc` declared-`Record` case ([[TEST-CLI-COMMANDS]]).

**The Go and JS suites are coupled.** The golden tests also compile the real
`examples/todos/app` sources and compare them with the committed fixtures under
`tests/fixtures/todos/`, the ones the vitest todos suite mounts
([[TEST-TODOS-INTEGRATION]]). A codegen change that alters todos emission fails Go until
the JS fixture is updated.

Regenerate goldens only deliberately, and review the diff:
`go test ./compiler/internal/codegen -update`.
