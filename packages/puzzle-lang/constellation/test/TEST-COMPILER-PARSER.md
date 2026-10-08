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
  - FILE-PARSER-LET
  - FILE-PARSER-HOST
  - FILE-EXPR-LEXER
  - FILE-EXPR-PARSER
  - FILE-EXPR-AST
  - FILE-EXPR-METHODS
  - FILE-EXPR-PRINT
  - FILE-PARSER-COMPONENT
notes:
  - kind: state
    text: >-
      0.8.1 host options are covered by three files. `let_test.go` (package parser_test,
      Options{Let} + checks skipped): accepted spellings, the tree with every position, the
      diagnostics table (Sites' own messages and positions, plus global/literal names and
      duplicates), `TestLetScope` (binding-call error after the block, gone at the end of the
      element / branch / when clause / loop body, sequential, self-reference reads the outer name),
      and entry points with checks left on. `host_test.go` (package parser_test): a wrapper-less
      splitter built ONLY from the exported host API, running the Sites splitter's tests (schema
      lifting, nesting, wrappers, schema attributes by name, errors, position stability), plus
      `TestParseMarkupSharesGrammar`, `TestParseMarkupAt`, `TestOptionsSkipChecks` and
      `TestHostScanners`. `options_test.go`: `TestOptionsDefaultIsPuzzleKit` parses the whole corpus
      with no options, `Options{}` and `Options{Let: true}` and requires identical trees/errors for
      every file without {#let} (compared with `sameTree`, a DeepEqual that treats NaN == NaN — a
      `NaN` literal parses to a float NaN); `TestOptionsLetOffIsUnknownBlock` pins the unchanged
      PuzzleKit messages for {#let}/{#assign}/{#set}/….
  - kind: state
    text: >-
      Review follow-up tests for 0.8.1. All timing tests take the best of three runs and are skipped
      under `-short`.


      `perf_test.go`:

      - `TestLargeLetBlockParsesWithinBudget`: a 430 KB `{#let}` block of 10.8k bindings, each
      calling a function, parses in about 22 ms. The budget is 100 ms, or 300 ms in CI.

      - `TestLongAttributeValueParsesWithinBudget`: a 400 KB attribute value with 50k braces parses
      in about 21 ms.


      `host_test.go`:

      - `TestParseMarkupDepthGuard`: a million levels of elements, components, blocks and attribute
      inline-ifs each give a positioned error. 200 levels pass and 201 fail; `MaxDepth` 5 and -1
      behave as set; the wrapped `Parse` keeps no limit.

      - `TestLetIsVoidForDepth`: 300 flat `{#let}` blocks pass both `ParseMarkup` and
      `OverNestingDepth`.

      - `TestHostLiftUnclosedBracesIsLinear`: 100k unclosed `{` return a positioned error in well
      under 1 s.

      - `TestHostScannerEdges`: out-of-range indexes, absolute `Find*Close` results, positioned
      errors.

      - `FuzzHostScanners`: every exported scanner, plus `ParseMarkup` and the example splitter, on
      arbitrary input. Its seeds run in `go test`; fuzz by hand with `-fuzz=FuzzHostScanners`.
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
- **Component selector** (`component_test.go`, D180 in the framework plan): the required expression-valued `is` preserves normal props and children, including ordinary `name`/`from` props; spread operands carry parsed trees and original positions. Missing/non-expression/non-component-literal/duplicate `is`, an authored `flip`, reserved Component family names and unsupported spreads have clear errors. Nullish selectors and `@flip` callback props remain valid. Generic corpus expression auditing includes `SpreadAttr` operands.
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
DECISION-D176-EXPRESSION-LANGUAGE, DECISION-D180-COMPONENT-SLOT, DOC-LANGUAGE-CORE, DOC-SPEC-TEMPLATE.
