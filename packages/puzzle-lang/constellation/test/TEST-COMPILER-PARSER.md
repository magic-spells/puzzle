---
name: Template parser, expression language, and section splitting
kind: unit
status: verified
framework: go test
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
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

Table-driven Go tests over the language module: section splitting, lexing, the
template grammar and AST, and the `expr` language with its shared conformance
table. **Run:** `cd packages/puzzle-lang && go vet ./... && go test ./...` — its
own Go module (D172), so the compiler's `go test ./...` does not run it (CI's Go
and Windows jobs do). Files: `expr/{conformance,expr,fuzz}_test.go` and
`parser/*_test.go`. Error positions and message text are contract here;
loosening one fails a test on purpose.

- **Sections:** script bodies are never parsed (bytes stay untouched JS/TS). A
  `{#raw}` span is skipped whole (`TestSplitSectionsRawBlockIsInert`: quotes,
  unbalanced braces, a literal `</puzzle-view>`, the whitespace-tolerant closer);
  a `{#raw}` with no closer still splits at the real close tag and reports
  "unterminated {#raw}" at the opener (`TestSplitSectionsUnterminatedRawBlock`).
- **Division vs regex** (`lexskip_test.go`): `TestLexPlainEndsExpr` pins which
  bytes end an expression; `TestParseDivisionInEveryTemplatePosition` parses
  `café / 2`, `金額 / 2`, `価格new / 2`, `5. / 2`, `of / 2` in every position; a
  regex-shaped template expression closes at its brace and fails with the
  grammar's error; the `<script>` scan keeps a regex holding a quote opaque.
- **Every construct parses:** conditionals and else-if chains, unless,
  case/when, loops, interpolation, comments, inline SVG, refs, raw blocks,
  composition markers, Portal, snippets, dotted family tags.
- **D167 tag names** (`TestParseComponentNamesD167`): `Straßenkarte`,
  `Übersicht`, `概要`, `Frame.Übersicht`, `ärmel`, `_x` are components;
  `straße-karte` stays an element; `<Über-sicht>`, `<Frame.٣x>`, `<Frame-x>`,
  `<Frame:Wrapper>`, `<Slot.Foo>` are positioned errors; `under <$50` is text.
- **Void elements** (`TestParseVoidElements`): `<br>`, `<br/>`, `<br />` build one
  tree, children after `<br>` belong to the parent, holds inside `{#raw}`,
  `<Input>` stays a component; a void closer is an error at the closer.
- **The shared expression table.** `expr/conformance_test.go` runs
  `conformance/expressions-parse.json`: each row is a source (optionally with
  handler, bindings or call-argument options) and either its S-expression tree
  with every node position or its error message at an exact line and column.
  Sites runs the same rows through `conformance.ExpressionsParse`, so both hosts
  agree on trees, errors and columns. `expr_test.go` pins what the table cannot:
  positions against a base, `Walk` order, `FormatNumber`, the method table and
  global result types, binding names, `TestEventOutsideAHandlerIsData`, and
  `TestLargeExpressionIsLinear` (six shapes from 16 KiB to 1 MiB; fails when
  per-byte cost grows, retrying on a busy runner).
- **Fuzzing:** `FuzzParse` seeds run in plain `go test`; the fuzzer runs by hand
  (`go test -run '^$' -fuzz=FuzzParse -fuzztime=60s ./expr`), not in CI.
- **Every expression position carries a tree** (`exprs_test.go`) at its own file
  position; `event` is the DOM event only in an `@event` value
  (`TestEventIsTheHandlersDOMEvent`) and a data field everywhere else
  (`TestEventOutsideAHandlerReadsTheDataField`).
- **Corpus proof** (`TestCorpusExpressionsParse`): every `.pzl` the monorepo ships
  or tests with (examples, scaffold templates, pieces registry and demo, DevTools
  panel, runtime fixtures, codegen and check goldens) must yield a tree at every
  expression position. Skips outside the monorepo.
- **Time budgets** (`perf_test.go`, best of three, skipped under `-short`, 3× when
  `CI` is set): a 20,000-line template parses in under 100 ms; a 40 KB `{#raw}` of
  `{` in under 20 ms (`TestLargeRawBlockParsesWithinBudget`).
- Composition markers are unique per render path (`slot_paths_test.go`); the
  playground nesting guard counts exactly for well-formed input (`depth_test.go`);
  an inline SVG may start with a BOM (`TestScanSVGFile`); lowercase markers steer
  to the capitalized form; a second `{:else}` is named at the stray clause
  (`TestParseElseIfErrors`/`UnlessErrors`/`CaseErrors`, `TestParseErrorPositions`).

**Gotcha:** `integration_test.go` parses copies of the todos example's
`Home.pzl`, `TodoItem.pzl`, `Default.pzl` vendored under `parser/testdata/todos`
(so the suite passes from the Go module cache), and
`TestFixturesMatchCanonicalExample` fails when a copy drifts from
`packages/puzzle/examples/todos` — refresh the copy in the same change.

Not run here: `conformance/functions.json` (PuzzleKit's vitest suite runs it),
and the codegen halves of these rules, in
`packages/puzzle/compiler/internal/codegen`: `TestVoidElementsNeedNoSlash`,
`TestEventAsDataAndInAHandlerIsAnError`, `TestEventOutsideAHandlerIsDataPzlCompile`,
`TestCompileUnicodeComponentTags`, `TestCompileUnicodeClassName`.

Contracts pinned (framework plan, `repo=puzzle`; plans cannot connect across
repos): COMPONENT-TEMPLATE-PARSER, DECISION-D150-RAW-TEMPLATE-BLOCK,
DECISION-D164-PLAYGROUND-WASM-BOUNDARY, DECISION-D166-SNIPPETS,
DECISION-D167-COMPONENT-FAMILIES, DECISION-D173-CORE-SEMANTICS,
DECISION-D176-EXPRESSION-LANGUAGE, DOC-LANGUAGE-CORE, DOC-SPEC-TEMPLATE.
