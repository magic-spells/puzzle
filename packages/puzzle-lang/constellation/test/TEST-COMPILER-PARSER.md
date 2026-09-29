---
name: Template parser, expression language, and section splitting
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
  - FILE-PARSER-EXPRS
  - FILE-EXPR-LEXER
  - FILE-EXPR-PARSER
  - FILE-EXPR-AST
  - FILE-EXPR-METHODS
  - FILE-EXPR-PRINT
---

# Template parser, expression language, and section splitting

Table-driven Go tests over the language module: `.pzl` section splitting,
lexing, the template grammar and its AST, and the expression language
(`expr`) with its shared conformance table.

What they guarantee:

- section scanning finds template, script, and style boundaries without ever
  parsing the script body. Script bytes stay untouched JavaScript or
  TypeScript.
- **a `{#raw}` span is skipped whole by the section splitter** (D150,
  `sections_test.go`). `TestSplitSectionsRawBlockIsInert` covers the docs-page
  shape, a code sample with `// it's`, an odd quote between balanced braces, an
  unbalanced brace with no quote, the whitespace-tolerant closer, a literal
  `</puzzle-view>` in the body, and a skeleton body; each one failed with
  "missing </puzzle-view>" on the splitter that scanned raw bodies as brace
  groups. `TestSplitSectionsUnterminatedRawBlock` pins the fallback: a `{#raw}`
  with no closer at all, or whose next `{/raw}` sits in the skeleton, still
  splits at the real close tag, and the parse reports "unterminated {#raw}" at
  the opener.
- the lexer skips correctly inside strings, comments, and raw regions, so
  template-looking bytes inside script or raw blocks are not treated as grammar.
- every shipped construct parses: conditionals and their else-if chains, unless,
  case/when, loops, interpolation, template comments, inline SVG, element refs,
  the raw block, composition markers, Portal, snippets, and dotted component
  family tags.
- **HTML void elements close at their start tag** (`TestParseVoidElements`):
  `<br>`, `<br/>` and `<br />` build the same tree, children after `<br>`
  belong to the parent, every void name is covered, `<input value={ x }
  readonly>` parses, the rule holds inside `{#raw}`, and `<Input>` stays a
  component. A void closing tag (`</input>`, `</br>`, a stray `</img>`) is an
  error at the closer, with its exact message and line and column.
- **the expression grammar is the shared table.** `expr/conformance_test.go`
  runs `conformance/expressions-parse.json` (421 cases at PR #171): each row is
  a source, optionally with handler, bindings or call-argument options, and
  either its S-expression tree (`expr.Print`) with every node position
  (`expr.PrintPositions`) or its error message at an exact line and column.
  Sites runs the same rows through `conformance.ExpressionsParse`, so both hosts
  build the same trees and report the same errors at the same columns — the
  pipe steer, the ambient-global steer, the `this` and `event` rules, the
  method-table and receiver-type checks, and every excluded operator included.
  `expr/expr_test.go` pins what the table cannot show: node positions against a
  base, `Walk` order, `FormatNumber`, the method table and global result types,
  binding names, and `TestLargeExpressionIsLinear`, which times six shapes (a
  flat operator chain, a long array, a long string, a long argument list, a
  member path, a template literal dense with substitutions) at 16 KiB to 1 MiB
  and fails when the per-byte cost grows, retrying so a busy runner does not.
- **every expression position carries a tree** (`exprs_test.go`): text,
  attributes, handlers, block headers, `{:when}` lists and `{#for}` headers each
  get a parsed tree at the expression's own file position; an expression error
  lands on the offending token wherever the expression sits; `event` is legal
  exactly where it is bound.
- **the corpus proof** (`corpus_test.go`, `TestCorpusExpressionsParse`) parses
  every `.pzl` file the monorepo ships or tests with — the framework's
  examples and scaffold templates, the pieces registry and demo, the DevTools
  panel, the runtime test fixtures, and the codegen and check goldens — and
  requires a tree at every expression position: 675 files and 10,094
  expressions at PR #172. Outside the monorepo (the Go module cache) the
  siblings are absent and it skips.
- **the time budgets** (`perf_test.go`, best of three, skipped under `-short`,
  three times the budget when `CI` is set): a 20,000-line template with
  expressions in every position template authors use parses, trees included,
  in under 100 ms; and a 40 KB `{#raw}` block of `{` parses in under 20 ms
  (`TestLargeRawBlockParsesWithinBudget`; about 0.3 ms, against 3.79 s when the
  splitter scanned raw bodies as brace groups).
- composition markers are unique per render path, not per file (D173 V13):
  exclusive branches may each carry the same marker, and a marker on the same
  path collides (`slot_paths_test.go`).
- the playground's nesting-depth guard counts depth without parsing, exactly for
  well-formed input, with void tags and stray void closers pushing and popping
  nothing (D164, `depth_test.go`).
- an inline SVG file may start with a UTF-8 byte-order mark, with or without an
  XML prolog after it (`TestScanSVGFile`, `inlinesvg_test.go`).
- rejections are positioned and actionable. A lowercase composition marker is a
  compile error steering to the capitalized form, not a silent no-op. That
  steering error is asserted, not just the rejection. A second `{:else}` in
  `{#if}`, `{#unless}` or `{#case}` is named at the stray clause, not reported
  as an unclosed block (`TestParseElseIfErrors`, `TestParseUnlessErrors`,
  `TestParseCaseErrors`, and the position check in `TestParseErrorPositions`).

Error positions and message text are treated as contract here. Loosening one
fails a test on purpose.

Covers 16 `*_test.go` files: `expr/conformance_test.go` and `expr/expr_test.go`,
and under `parser/`: `corpus`, `depth`, `exprs`, `inlinesvg`, `integration`,
`lexer`, `lexskip`, `parser`, `perf`, `portal`, `refs`, `sections`,
`slot_paths` and `snippets` — 1,211 passing tests and subtests at PR #172.
That is its own Go module (D172), so the
compiler's `go test ./...` does not run them. Run `go test ./...` inside
`packages/puzzle-lang` (CI's Go and Windows jobs do). `integration_test.go`
parses copies of the todos example's `Home.pzl`, `TodoItem.pzl`, and
`Default.pzl`, vendored under `parser/testdata/todos`, so the suite is
self-contained and also passes from the Go module cache.
`TestFixturesMatchCanonicalExample` fails when a copy drifts from
`packages/puzzle/examples/todos` (it skips outside the monorepo), so a change
to the example must refresh the copy in the same change. `functions.json`,
the function library's table in the same `conformance` package, is run by
PuzzleKit's vitest suite, not by this module. The codegen side of the void
rule — the self-closed and slash-less spellings emit byte-identical modules —
is PuzzleKit's `TestVoidElementsNeedNoSlash`
(`packages/puzzle/compiler/internal/codegen/core_semantics_test.go`).

## Contracts it pins (in the connected `puzzle` plan)

The behavior these tests pin is owned by cards in the framework plan
(`repo=puzzle`), which cannot be graph connections from this plan:
COMPONENT-TEMPLATE-PARSER; DECISION-D03-SCRIPTS-REAL-JS,
DECISION-D22-NO-ESCAPE-BY-DEFAULT, DECISION-D36-UNLESS, DECISION-D37-CASE-WHEN,
DECISION-D40-ELSE-IF, DECISION-D46-INLINE-SVG, DECISION-D70-TEMPLATE-COMMENTS,
DECISION-D134-CAPITALIZED-COMPOSITION-MARKERS, DECISION-D144-PORTAL,
DECISION-D150-RAW-TEMPLATE-BLOCK, DECISION-D164-PLAYGROUND-WASM-BOUNDARY,
DECISION-D166-SNIPPETS, DECISION-D167-COMPONENT-FAMILIES,
DECISION-D173-CORE-SEMANTICS, DECISION-D176-EXPRESSION-LANGUAGE;
DOC-LANGUAGE-CORE, DOC-TEMPLATE-SYNTAX, DOC-COMPILER-DESIGN, DOC-TESTING.
