---
name: template parser entry
status: verified
path: parser/parser.go
language: go
summary: >-
  Recursive-descent template parser and grammar validation: every expression position handed to
  expr.Parse through exprs.go, the {#for}/{#case}/{:when} header shapes, {#unless} as a negated
  condition, HTML void elements closed at their start tag, binding-name checks, and D167 component
  classification and name validation (with lexer.go's Unicode tag-name lexing).
verified_at: '2026-11-01T19:25:05.616Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
connections:
  - FILE-PARSER-COMPONENT
---

# parser.go

The recursive-descent template parser and its grammar validation. Behavioral
intent: COMPONENT-TEMPLATE-PARSER in the framework plan (`repo=puzzle`).

- **Entry points** `Parse`, `ParseTemplate`, `ParseSkeleton` and `ParseFile` each
  take an optional trailing `Options` ([[FILE-PARSER-HOST]]); the zero value is
  PuzzleKit's grammar. The parser holds `opts`, a nested `{#raw}` parser inherits
  them, and the post-parse island/slot/ref checks run through `Options.validate`.
  `parseBlock`'s `case "let"` hands to `parseLet` ([[FILE-PARSER-LET]]) only when
  `Let` is on; otherwise `unknownBlockErr` gives PuzzleKit's message.
  `parseChildren` defers `p.unbind(len(p.bound))`, so a child list scopes the
  `{#let}` names inside it.
- **Every expression position is one `expr.Parse`** (DECISION-D176-EXPRESSION-LANGUAGE,
  D173 V1), called through `parseExprAt` ([[FILE-PARSER-EXPRS]]) with the
  enclosing bindings in scope: interpolations, brace-only attribute values and
  `@event` values (`buildAttr`, with handler options), the
  `{#if}`/`{:else if}`/`{#unless}`/`{#case}` headers (`parseBlock`), `{:when}`
  value lists (`splitWhenValues`, top-level commas only), and the `{#for}` header
  (`parseForHeader` → `peelForCounter`/`splitForIn`), which splits
  `item in collection, i` or `a...b, x` and hands each piece to `expr`. This file
  never reads inside an expression; a `|` is `expr`'s business (a Sites pipe with
  `Options.Pipes`, the steer error without).
- **Component selectors and spread props (D180).** `<Component>` is a
  `Component` AST node with a reserved name; [[FILE-PARSER-COMPONENT]] validates
  its `is`. `parseAttrs` turns a `TokAttrBrace` with a leading `...` into a
  `SpreadAttr` (expression parsed at its original file position) and rejects
  spreads on elements and composition markers. `Component` cannot be a dotted
  family root.
- **`{#unless c}`** stores `!` over the parsed condition — one tree shape.
- **A second `{:else}`** in `{#if}`/`{#unless}`/`{#case}` is reported at the stray
  clause ("a second {:else} in {#if} opened at L:C — {:else} must be the last
  clause"), not as "unclosed {#if}".
- **HTML void elements** (`voidElements`: `area base br col embed hr img input
  link meta source track wbr`, exact lowercase) close at their start tag, so
  `<br>`, `<br/>`, `<br />` build the same AST; `checkCloser` rejects `</input>`
  or a stray `</br>` at the closer. Holds inside `{#raw}`; a component tag
  (`<Input>`) is never void.
- **Binding names** (a `{#for}` item or counter, a `<Snippet>` parameter, a
  generated binding) go through `loopBindingIdentError`/`snippetParamIdentError`/
  `generatedBindingIdentError` against `expr`'s one binding-name rule;
  `{#for i in 1...5}` steers to `{#for 1...5, i}`.
- **Tag names and components (D167).** `lexer.go` reads the tag name:
  `startsTagName` accepts an ASCII letter, `_` or a non-ASCII `jsident.IsIDStart`
  rune; `tagNameEnd` continues through letters, digits, `_ - : .` or a non-ASCII
  `jsident.IsIDContinue` rune. `$` never starts or continues one (`<$50` is text).
  `isComponentName` makes a tag a component when its first byte is not an ASCII
  lowercase letter (`<Card>`, `<Übersicht>`, `<概要>`, `<_x>`; `<straße-karte>`
  stays an element); `checkComponentName` requires `Ident('.'Ident)*` with
  `$`-free JS-identifier segments (`isIdentSegment`) and rejects a composition
  marker as a family root (`<Slot.Foo>`).

Siblings with no FILE card, whose contracts live on COMPONENT-TEMPLATE-PARSER:
`depth.go` (`OverNestingDepth` for the playground, D164, and the `scanNesting`
token scan `ParseMarkup`'s depth guard reuses — void start tags, stray void
closers, `{#svg}` and `{#let}` count no level, so for a well-formed template it
counts exactly the AST's containers) and `inlinesvg.go` (`ScanSVGFile`, D46 —
skips a leading UTF-8 BOM, error positions kept in file coordinates).
[[TEST-COMPILER-PARSER]] covers both.
