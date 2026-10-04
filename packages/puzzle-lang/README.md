# puzzle-lang

The Puzzle template language as a Go module:
`github.com/magic-spells/puzzle/packages/puzzle-lang`.

Puzzle is one template language with two dialects (PuzzleKit and Magic Spells
Sites; decision D172). This module is where the shared language lives:

- `parser` — the `.pzl` section splitter, the HTML-aware lexer, the
  recursive-descent template parser, the AST, and positioned `ParseError`s.
- `expr` — the expression language: everything between a template's braces
  parsed into a tree both hosts consume (see below).
- `conformance` — the shared conformance tables, embedded so a host pins them
  at the module version it imports.
- `jsident` — the JavaScript reserved-binding-word table the parser and the
  compiler's code generator share.
- `textutil` — small text helpers (plural suffixes, the edit distance behind
  did-you-mean errors) shared by the parser and the compiler.

It holds no code generation, bundling, or CLI. Those stay in the PuzzleKit
compiler (`packages/puzzle/compiler`).

## The expression language (`expr`)

A template expression looks and behaves like JavaScript, but it is a closed
grammar, not JavaScript: PuzzleKit lowers the tree to JavaScript and Sites
evaluates it in Go, so both accept exactly the same source. The package holds
syntax, positions, and names only — no lowering and no evaluation.

```go
n, err := expr.Parse(src, expr.Pos{Line: 12, Col: 9, Offset: 340}, expr.Options{})
```

`Parse` takes the expression text and where its first byte sits in the file,
so every node and every error is in file coordinates (columns count bytes,
as `parser.Position` does). The error is an `*expr.Error` with the same
fields as `parser.ParseError` minus the file name.

**The grammar.** Literals: `'…'` and `"…"` strings with JavaScript's
strict-mode escapes; template literals with nested `${ }`; decimal numbers
(`1`, `1.5`, `.5`, `1e3`); `true`, `false`, `null`, `undefined`, `NaN`,
`Infinity`; arrays; objects with name, quoted, and shorthand keys. Names are
Unicode identifiers. Member access `a.b`, `a?.b`, `a[i]`, `a?.[i]`;
`__proto__`, `constructor`, and `prototype` are rejected as member names and
object keys. Calls: a library function `name(args)`, a method `a.m(args)` /
`a?.m(args)` whose name must be in the method table (`methods.go`) — checked
against the receiver's own type when the syntax fixes it (`'s'.filter(f)`,
`[1].trim()`, `(1).trim()`, `String(x).map(f)` are errors), by name alone
otherwise, since a data value's type is known only when the template runs —
and the allowed JavaScript globals (`Math.round`, `Object.keys`, `Array.isArray`,
`Number`, `String`, `Boolean`, `parseInt`, `parseFloat`, `isNaN`,
`isFinite`). A global is only ever called — `items.filter(Boolean)` is an
error; write `x => Boolean(x)` — except the two readable constants `Math.PI`
and `Math.E`. Arrow functions `x => expr` and
`(x, i) => expr` only as call arguments. Operators with JavaScript precedence:
unary `! - +`; `* / %`; `+ -`; `< <= > >=`; `== != === !==`; `&&`; `||`;
`??` (not mixed with `||`/`&&` without parentheses); `?:`. Everything else —
bitwise operators, `**`, assignment, `++`/`--`, the comma operator, `new`,
`typeof`, `in`, `instanceof`, regex literals, spread, comments, statements,
`this` — is a positioned error that names the construct and, where there is
one, what to write instead. There are no formatter pipes: a `|` is the steer
"`| name` pipes were removed — write `name(value)`", or, after a formatter that
is no longer a function (`| upcase`), the JavaScript that replaces it
(`RemovedFormatters`), so a 0.7 template fails at the pipe itself. A read of
the browser's global objects — `window`, `document`, `globalThis` — is an
error too, unless a template binding or an arrow parameter owns the name:
`data()` reads them. Other browser globals (`location`, `console`, …) are
ordinary data names. `encodeURIComponent`, `decodeURIComponent`, `encodeURI`
and `decodeURI` are callable globals beside `Number`, `String` and the rest.

**The tree.** `Literal`, `TemplateLiteral`, `Identifier`, `Member`, `Call`,
`Arrow`, `Unary`, `Binary`, `Logical`, `Conditional`, `Array`, `Object`,
`Global`, and `Chain` (the extent of an optional chain, as ESTree's
`ChainExpression`). Every node has `Pos()`; `Walk` visits a tree in source
order; `Print` renders the compact S-expression the fixtures use.

**Names.** `eval` and `arguments` read like any data field. A name a
template *binds* — an arrow parameter, a `{#for}` item or counter, a
`<Snippet>` parameter (a `{#let}` name in Sites) — follows one rule,
`IsIdentifier` plus `BindingNameReason`: a Unicode identifier that is not a
strict-mode reserved word (`eval` and `arguments` included), a literal word
(`NaN`, `Infinity`, `undefined`), or a JavaScript global the language gives
a meaning to (`Math`, `Number`, `Boolean`, …). `event` may be bound. A bound
name is a value: it reads, and calling it is an error, so `t('key')` inside
`{#for t in …}` never reaches the library's `t`.

**Options.**
- `Handler` parses an `@event` handler value. It is a PuzzleKit-only
  extension; Sites has no handlers. There the FREE name `event` is the
  browser's DOM event, so a member chain rooted at it reads any property and
  calls any method with no method-table check (`event.target.closest('li')`,
  `event.preventDefault()`, `event.target.files.item(0)`). A bound `event` —
  `{#for event in …}`, a snippet parameter, `items.map(event => …)` — shadows
  it, as in JavaScript, and its chain is ordinary data even in a handler. The
  handler's own call — the whole value, or a branch of a top-level
  conditional — names a view handler, so it may share a name with a binding.
  Outside a handler `event` is an ordinary name: it reads the data field or
  prop named `event`, like any other.
- `Bindings` lists the names the enclosing template constructs bind; the
  template parser passes them, and each reads but cannot be called.

**In the template parser.** Every AST field that holds an expression string
has a parsed sibling filled while parsing — `Interpolation.ExprAST`,
`DynamicAttr.ExprAST`, `EventAttr.ExprAST`,
`If.CondAST`, `InlineIfPart.CondAST`, `Case.ExprAST`, `WhenClause.ValuesAST`,
and `For.CollectionAST` / `RangeFromAST` / `RangeToAST` — and an expression
error is a `ParseError` at the offending token. `{#unless}` keeps its folded
`!(…)` string, and its tree is a `Unary` `!` over the parsed condition.

The template parser binds names with the same rule: `{#for größe in sizes}`
and `<Snippet fits="row" größe>` work, and `{#for NaN in …}` or
`<Snippet Math>` is a positioned error. An attribute name may be Unicode but
starts with `@`, an ASCII letter, `_`, or a letter — never a mark or a digit.

**The contract** is `conformance/expressions-parse.json`: every grammar rule
and every error. An accepted case pins its tree and the position of every
node (line, column, and offset, in `Walk` order, from `expr.PrintPositions`);
a rejected case pins its message, line, column, and offset; a few cases start
from a base position inside a file. `go test ./expr` runs it; a host runs the
same rows through `conformance.ExpressionsParse`, `expr.Print`, and
`expr.PrintPositions`.

## Host options

The parser knows every construct in the language; each host turns on the
extensions it uses and turns off the checks that do not apply to it (D172).
Every entry point — `Parse`, `ParseTemplate`, `ParseSkeleton`, `ParseFile`,
`ParseMarkup` — takes an optional trailing `parser.Options`. The zero value is
PuzzleKit's grammar, so passing nothing parses exactly as PuzzleKit always has.

```go
root, err := parser.ParseMarkup(markup, parser.Position{}, "sections/Hero.pzl", parser.Options{
	Let:             true, // {#let name = expression}
	SkipIslandCheck: true, // the host diagnoses island, slots and ref itself
	SkipSlotCheck:   true,
	SkipRefCheck:    true,
})
```

- **`Let`** turns on `{#let}`: a void block, `{#let total = price * qty}` or
  one assignment per line in the multiline form. Bindings are sequential (each
  sees the ones above it, never itself), scoped to the child list the block
  sits in, and may be shadowed by a later `{#let}`; one block may not name a
  value twice. A right-hand side is one expression, parsed into
  `LetBinding.Interp.ExprAST`, and the names reach every later expression in
  scope as bindings, like `{#for}` names. Off, `{#let}` is the ordinary
  unknown-block error.
- **`SkipIslandCheck`, `SkipSlotCheck`, `SkipRefCheck`** turn off the
  post-parse `island`, composition-marker and `ref` rules.
- **`MaxDepth`** (read by `ParseMarkup` only) caps template nesting. The parser
  is recursive descent, so an untrusted file nested a million levels deep would
  exhaust the stack, which `recover()` cannot catch. `ParseMarkup` runs a
  counting token scan first and returns a positioned error past the limit. 0
  means `DefaultMaxDepth` (200, the playground's limit) and a negative value
  turns the guard off.

**Files without a wrapper.** `ParseMarkup(markup, at, filename, opts)` parses
template content with no `<puzzle-view>` wrapper, starting at file position
`at` (zero means 1:1), and returns a synthetic container `Element` with an
empty `Tag`. A host that lifts its own top-level blocks blanks each to spaces,
newlines kept, so every position stays the author's. For that splitter the
module exports the scanners its own section splitter and lexer use, so a host
reads a file exactly as the parser will: `TagNameAt`, `ScanOpenTag`,
`FindScriptClose`, `FindStyleClose`, `FindTemplateClose`, `ScanBraceGroup`,
`SkipBraceGroup` (comments and `{#raw}` spans whole), `AttrNames` (names only,
values never parsed), `ParseAttrString`, `ParseScriptLang` and
`ParseStyleScoped`. They take the whole file, every index in or out is
absolute, an out-of-range index is an answer (-1 or an error), never a panic,
and every error is a positioned `*ParseError`. When `SkipBraceGroup` fails, the
parse would fail at that brace too: return the error, or stop and let
`ParseMarkup` report it. Never step one byte and retry, which is quadratic on
a file of unclosed braces. `parser/host_test.go` is a wrapper-less splitter
built from these alone, and `FuzzHostScanners` fuzzes all of them.

## Who imports it

- **PuzzleKit's compiler** (`packages/puzzle`). Its `go.mod` requires this
  module at `v0.0.0` and replaces it with `../puzzle-lang`, so the compiler
  always builds against the working tree.
- **Magic Spells Sites**, from `v0.8.1`, with `Options{Let: true}` and the
  three checks skipped, parsing its theme files through `ParseMarkup`. Its own
  code keeps only the theme-file splitter (`<schema>` lifting) and its
  migration tools.

## Versions

This module versions in lockstep with the framework: its release is the
framework's version number. The Go toolchain finds a version of a module in a
repository subdirectory only through a tag prefixed with that directory, so
consumers outside this repo need a `packages/puzzle-lang/vX.Y.Z` tag next to
the framework's `vX.Y.Z` tag:

```bash
go get github.com/magic-spells/puzzle/packages/puzzle-lang@v0.8.1
```

A patch release may be Go-only: `v0.8.1` added the host options with no
framework or npm release beside it, so its tag stands alone.

## Plan

This module has its own Constellation plan in `constellation/` (the
`puzzle-lang` connected repo; `repo=packages/puzzle-lang` from the monorepo
root). It holds the parser's code binding — a FILE card per load-bearing parser
and `expr` file and the test card for this module's suite — so drift in
`parser/` or `expr/` shows up in this plan's stale report. The parser's behavioral contract
(COMPONENT-TEMPLATE-PARSER) and every language decision card (D172 through
D176, and the grammar decisions before them) live in the framework plan,
`packages/puzzle/constellation`.

## Tests

```bash
cd packages/puzzle-lang
go vet ./... && go test ./...
```

The parser's integration tests parse copies of the todos example's `.pzl`
files, vendored under `parser/testdata/todos`, so the module's tests are
self-contained and run the same from a monorepo checkout or the module cache.
From a monorepo checkout, `TestCorpusExpressionsParse` also parses every
`.pzl` file under the framework's examples, the scaffold templates, the pieces
registry, and the codegen goldens, and requires every expression in them to
parse; outside the monorepo it skips.
