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
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Codegen emission and golden files

The byte-level emission contract. Per-construct golden pairs live in
`compiler/internal/codegen/testdata` as a `.pzl` input beside its expected
JavaScript, compiled and byte-compared.

**Expression lowering** ([[DECISION-D176-EXPRESSION-LANGUAGE]]) is pinned by
three goldens: `expr_methods` (method chains and their guards, arrow
arguments, `Object.keys`, `Math.*`, `?.`/`??`, a template literal, `NaN` and
friends, `reduce`/`some`/`find`, a filtered `{#for}` header and condition,
and library calls beside methods), `expr_handlers` (bare, called and
conditional handler values, handler arguments with methods, an object literal,
a `t(…)` call and arrow chains, a free `event` chain, a library-named handler,
and handlers inside a list row), and `formatter_chain`, which keeps its name
and holds nested function calls (`truncate(capitalize(title), 20)`) and a
call with literal arguments. Beside them, `expr_test.go` pins the lowering
itself (name resolution from the tree, arrow-parameter mangling, handler
lowering, the `this` safety net, and the handler/library collision warning);
`core_semantics_test.go` pins the language in every position (member guards,
loose equality, a library call in every value position, the pipe error in
every header, one-way transformed form values, `.size` as an ordinary field);
`row_facts_test.go` pins the D170 row facts read off the tree;
`markup_test.go` and `markup_call_test.go` pin the `raw`/`newline_to_br`
placement rule; and `presets_test.go` pins the literal date-preset and zone
check in every position the language reaches, handler arguments included.

Beyond the goldens, focused tests cover event handler emission and handler
caching, class-name extraction, empty and boolean attributes, conditional
arity stabilization, loop item identifiers and range parens, list keys, list
blocks and static-subtree caching, inline SVG with its cache and dedup, scoped
styles, script name collisions, module stamping, refs, reserved script
bindings, skeleton minimum duration, the raw block, display coercion, text-run
whitespace, Portal at a component root, template comments, and a11y warnings.

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

Covers 35 `*_test.go` files under `compiler/internal/codegen`.
