---
name: Template parser and section splitting
kind: unit
status: verified
framework: go test
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: verified
    text: >-
      0.8.0 release-prep sweep. Each bound file was diffed against the b1a8642a baseline. scan.go is
      byte-identical, since only the path moved into puzzle-lang. sections.go changed only its
      textutil import path and one comment. parser.go gained the D173 V1 chain rule (parseChain,
      isFormatterName, the {#for}/{:when} pipe bans) and the D167 name check. slot.go gained D166
      snippet markers and the D173 V13 per-path pass. The bodies now say so. The test count is 12
      files. `go vet` and `go test ./...` pass in packages/puzzle-lang.
    sha: a602784a9822fa3ff63123e597f72624b3c9ffff
connections:
  - FILE-PARSER
  - FILE-PARSER-SECTIONS
  - FILE-PARSER-SCANNER
  - FILE-PARSER-SLOT
---

# Template parser and section splitting

Table-driven Go tests over the compiler front end: `.pzl` section splitting,
lexing, the template grammar, and the AST.

What they guarantee:

- section scanning finds template, script, and style boundaries without ever
  parsing the script body. Script bytes stay untouched JavaScript or
  TypeScript.
- the lexer skips correctly inside strings, comments, and raw regions, so
  template-looking bytes inside script or raw blocks are not treated as grammar.
- every shipped construct parses: conditionals and their else-if chains, unless,
  case/when, loops, interpolation, template comments, inline SVG, element refs,
  the raw block, composition markers, Portal, snippets, and dotted component
  family tags.
- the formatter-chain rule holds in every value position (D173 V1): a
  top-level single `|` splits into a chain in attributes, props, marker
  arguments and block subjects; what follows a pipe must be a formatter name;
  and a pipe in a `{#for}` header or a `{:when}` value is a positioned error
  (`chain_test.go`).
- composition markers are unique per render path, not per file (D173 V13):
  exclusive branches may each carry the same marker, and a marker on the same
  path collides (`slot_paths_test.go`).
- the playground's nesting-depth guard counts depth without parsing, exactly for
  well-formed input (D164, `depth_test.go`).
- rejections are positioned and actionable. A lowercase composition marker is a
  compile error steering to the capitalized form, not a silent no-op. That
  steering error is asserted, not just the rejection.

Error positions and message text are treated as contract here. Loosening one
fails a test on purpose.

Covers 12 `*_test.go` files under `packages/puzzle-lang/parser`: `chain`,
`depth`, `inlinesvg`, `integration`, `lexer`, `lexskip`, `parser`, `portal`,
`refs`, `sections`, `slot_paths` and `snippets`. That is its own Go module
(D172), so the compiler's `go test ./...` does not run them. Run
`go test ./...` inside `packages/puzzle-lang` (CI's Go and Windows jobs do).
`integration_test.go` parses copies of the todos example's `Home.pzl`,
`TodoItem.pzl`, and `Default.pzl`, vendored under `parser/testdata/todos`, so
the suite is self-contained and also passes from the Go module cache. Refresh
a copy when `packages/puzzle/examples/todos` changes in a way the tests should
follow.

## Contracts it pins (in the connected `puzzle` plan)

The behavior these tests pin is owned by cards in the framework plan
(`repo=puzzle`), which cannot be graph connections from this plan:
COMPONENT-TEMPLATE-PARSER; DECISION-D03-SCRIPTS-REAL-JS,
DECISION-D22-NO-ESCAPE-BY-DEFAULT, DECISION-D36-UNLESS, DECISION-D37-CASE-WHEN,
DECISION-D40-ELSE-IF, DECISION-D46-INLINE-SVG, DECISION-D70-TEMPLATE-COMMENTS,
DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS, DECISION-D144-PORTAL,
DECISION-D150-RAW-TEMPLATE-BLOCK, DECISION-D164-PLAYGROUND-WASM-BOUNDARY,
DECISION-D166-SNIPPETS, DECISION-D167-COMPONENT-FAMILIES,
DECISION-D173-CORE-SEMANTICS; DOC-TEMPLATE-SYNTAX, DOC-COMPILER-DESIGN,
DOC-TESTING.
