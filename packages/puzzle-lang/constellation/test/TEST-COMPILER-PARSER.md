---
name: Template parser, expression language, and section splitting
kind: unit
status: verified
framework: go test
verified_at: '2026-11-24T18:13:22.097Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
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
---

# Template parser, expression language, and section splitting

Table-driven Go tests over the language module: section splitting, lexing, the
template grammar and AST, the host options, and the `expr` language with its
shared conformance table. **Run:** `cd packages/puzzle-lang && go vet ./... && go test ./...`
— its own Go module (D172), so the compiler's `go test ./...` does not run it (CI's
Go and Windows jobs do). Files: `expr/{conformance,expr,fuzz}_test.go` and
`parser/*_test.go`. Error positions and message text are contract here;
loosening one fails a test on purpose.

- **Sections:** script bodies are never parsed (bytes stay untouched JS/TS). A
  `{#raw}` span is skipped whole (`TestSplitSectionsRawBlockIsInert`); a `{#raw}`
  with no closer still splits at the real close tag and reports "unterminated
  {#raw}" at the opener (`TestSplitSectionsUnterminatedRawBlock`).
  `TestSplitSectionsQuotedSectionText` and `TestSplitSectionsQuotedTemplateClose`
  pin section tags inside quoted attributes; both `split.js` ports carry the same
  regressions.
- **Division vs regex** (`lexskip_test.go`): `TestLexPlainEndsExpr` pins which
  bytes end an expression; `TestParseDivisionInEveryTemplatePosition` parses
  `café / 2`, `金額 / 2`, `価格new / 2`, `5. / 2`, `of / 2` in every position; a
  regex-shaped template expression closes at its brace and fails with the
  grammar's error; the `<script>` scan keeps a regex holding a quote opaque.
- **Every construct parses:** conditionals and else-if chains, unless,
  case/when, loops, interpolation, comments, inline SVG, refs, raw blocks,
  composition markers, Portal, snippets, dotted family tags.
- **Component selector** (`component_test.go`, D180): required expression-valued
  `is`, ordinary `name`/`from` props, spread operands with parsed trees and
  original positions; errors for missing/literal/duplicate `is`, authored `flip`,
  `Component` as a family root, and spreads where they are not allowed.
- **Router outlet** (`outlet_test.go`, D199): each default-position marker
  records the tag written (`TestMarkerRecordsSpelling`); a `<Slot>` with no name
  is an error with its note, and parses with `SkipSlotCheck`; `<Outlet>` takes no
  attributes; `<outlet>` steers to `<Outlet/>`; `<Outlet/>` and `<Children/>`
  share one default position per render path.
- **D167 tag names** (`TestParseComponentNamesD167`): `Straßenkarte`,
  `Übersicht`, `概要`, `Frame.Übersicht`, `ärmel`, `_x` are components;
  `straße-karte` stays an element; `<Über-sicht>`, `<Frame.٣x>`, `<Frame-x>`,
  `<Frame:Wrapper>`, `<Slot.Foo>` are positioned errors; `under <$50` is text.
- **Void elements** (`TestParseVoidElements`): `<br>`, `<br/>`, `<br />` build one
  tree, children after `<br>` belong to the parent, holds inside `{#raw}`,
  `<Input>` stays a component; a void closer is an error at the closer.
- **Other frameworks' spellings** (`foreign_syntax_test.go`):
  `TestForeignAttributes` pins every steer's message and position on a
  `<button>`, through `Parse` and through `ParseMarkup` at an offset base (its
  depth pre-scan must not replace the positioned error);
  `TestForeignAttributeNamesWithoutValues` requires valueless and valued names to
  fail alike; `TestForeignAttributeExemptions` pins what still compiles — the
  plain names and brace `on…` as component props, static and valueless
  `onclick`, `on={ x }`, a custom element's `on…` (`once`, `onboarding`,
  `onDoubleClick`), and all of it inside `{#raw}`;
  `TestForeignColonAttributesOnComponents` the colon steers on `<Button>`;
  `TestForeignAttributeReviewRegressions` the `v-model` steer naming `checked`,
  the `<puzzle-view>` root (`className` rejects, brace `onclick` compiles),
  `on:submit|preventDefault` steering at the name, `<my-el className>` and
  `<rect onclick={ f }>`; `TestSkipForeignSyntaxCheck` that the switch compiles
  the plain names and brace `on…`, leaves colon names their namespace or lexer
  error, and that `ParseAttrString` on another tag and `AttrNames` give the
  lexer's plain `:` error; `TestForeignHTMLInterpolation` the `{@html}` steer
  with and without the switch. `TestParseReservedAttributeNamespaces`
  (`parser_test.go`) pins both namespace messages.
- **The shared expression table.** `expr/conformance_test.go` runs
  `conformance/expressions-parse.json`: each row is a source (optionally with
  `handler`, `bindings` or `pipes` set) and either its S-expression tree with
  every node position or its error message at an exact line and column. Sites runs
  the same rows through `conformance.ExpressionsParse`, so both hosts agree on
  trees, errors and columns. `expr_test.go` pins what the table cannot: positions
  against a base, `Walk` order, `FormatNumber`, the method table and global result
  types, binding names, `TestEventOutsideAHandlerIsData`, and
  `TestLargeExpressionIsLinear` (fails when per-byte cost grows).
- **Fuzzing:** `FuzzParse` and `FuzzHostScanners` seeds run in plain `go test`;
  the fuzzers run by hand (`go test -run '^$' -fuzz=FuzzParse -fuzztime=60s ./expr`),
  not in CI.
- **Every expression position carries a tree** (`exprs_test.go`) at its own file
  position; `event` is the DOM event only in an `@event` value
  (`TestEventIsTheHandlersDOMEvent`) and a data field everywhere else
  (`TestEventOutsideAHandlerReadsTheDataField`).
- **Host options.** `options_test.go`: `TestOptionsDefaultIsPuzzleKit` parses the
  corpus with no options, `Options{}`, `Pipes` on (every file that parses must
  parse to the same tree) and `Let` on (every file without `{#let}` must match),
  comparing with `sameTree`, a DeepEqual that treats NaN == NaN;
  `TestOptionsLetOffIsUnknownBlock` pins PuzzleKit's messages for
  `{#let}`/`{#assign}`/…. `pipes_test.go`: a pipe in every expression position
  parses to its written call's tree, pipe errors with pipes on, and a statement
  word after `|` (`x | default(0)`). `let_test.go`: spellings, trees with
  positions, the diagnostics table, and `TestLetScope`. `host_test.go`: a
  wrapper-less splitter built only from the exported host API running the Sites
  splitter's tests, `TestParseMarkupDepthGuard` (200 levels pass, 201 fail,
  `MaxDepth` 5 and -1 behave as set, the wrapped `Parse` has no limit),
  `TestHostScannerEdges`, `TestHostLiftUnclosedBracesIsLinear`.
- **Corpus proof** (`TestCorpusExpressionsParse`): every `.pzl` the monorepo ships
  or tests with (examples, the `puzzle init` starters, pieces registry and demo, DevTools
  panel, runtime fixtures, codegen and check goldens) must yield a tree at every
  expression position. Skips outside the monorepo.
- **Time budgets** (`perf_test.go`, best of three, skipped under `-short`, 3× when
  `CI` is set): a 20,000-line template under 100 ms; a 40 KB `{#raw}` of `{`
  under 20 ms; a 430 KB `{#let}` block and a 400 KB attribute value with 50k
  braces each under 100 ms. On a loaded machine the 20,000-line budget can miss
  locally; rerun idle before reading it as a regression.
- Composition markers are unique per render path (`slot_paths_test.go`); the
  nesting scan counts exactly for well-formed input and treats `{#let}` as void
  (`depth_test.go`; `TestLetIsVoidForDepth` in `host_test.go`); an inline SVG may start with a BOM
  (`TestScanSVGFile`); lowercase markers steer to the capitalized form; a second
  `{:else}` is named at the stray clause (`TestParseElseIfErrors`/`UnlessErrors`/
  `CaseErrors`, `TestParseErrorPositions`).

**Gotcha:** `integration_test.go` parses copies of the todos example's
`Home.pzl`, `TodoItem.pzl`, `Default.pzl` vendored under `parser/testdata/todos`
(so the suite passes from the Go module cache), and
`TestFixturesMatchCanonicalExample` fails when a copy drifts from
`packages/puzzle/examples/todos` — refresh the copy in the same change.

Not run here: `conformance/functions.json` (PuzzleKit's vitest suite runs it),
and the codegen halves of these rules in
`packages/puzzle/compiler/internal/codegen`: `TestVoidElementsNeedNoSlash`,
`TestEventAsDataAndInAHandlerIsAnError`, `TestEventOutsideAHandlerIsDataPzlCompile`,
`TestCompileUnicodeComponentTags`, `TestCompileUnicodeClassName`.

Contracts pinned (framework plan, `repo=puzzle`; plans cannot connect across
repos): COMPONENT-TEMPLATE-PARSER, DECISION-D147-IMPLICIT-TWO-WAY-BINDING,
DECISION-D150-RAW-TEMPLATE-BLOCK, DECISION-D164-PLAYGROUND-WASM-BOUNDARY,
DECISION-D166-SNIPPETS, DECISION-D167-COMPONENT-FAMILIES,
DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS, DECISION-D173-CORE-SEMANTICS,
DECISION-D176-EXPRESSION-LANGUAGE, DECISION-D180-COMPONENT-SLOT,
DECISION-D199-UPGRADE-PASS, DOC-LANGUAGE-CORE, DOC-SPEC-TEMPLATE.
