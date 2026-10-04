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
verified_at: '2026-09-25T10:41:32.868Z'
verified_sha: a602784a9822fa3ff63123e597f72624b3c9ffff
notes:
  - kind: state
    text: >-
      0.8.1 (Go-only): the parser carries host options (FILE-PARSER-HOST). `parser` holds `opts
      Options`; `newParser` takes it and the nested {#raw} parser inherits it.
      Parse/ParseTemplate/ParseSkeleton/ParseFile take an optional trailing `Options` (zero =
      PuzzleKit), and their three post-parse checks run through `Options.validate`. `parseBlock` has
      a `case "let"` that hands to `parseLet` (FILE-PARSER-LET) only when `Let` is on; the
      unknown-block message comes from `unknownBlockErr`, unchanged for PuzzleKit. `parseChildren`
      now defers `p.unbind(len(p.bound))` so a child list is the scope of the {#let} names inside it
      — a no-op when nothing was bound. `nodePos` knows `*Let`.
---

# parser.go

The recursive-descent template parser and its grammar validation. Behavioral
intent: COMPONENT-TEMPLATE-PARSER in the framework plan (`repo=puzzle`); `path`
is relative to `packages/puzzle-lang`.

- **Every expression position is one `expr.Parse`** (DECISION-D176-EXPRESSION-LANGUAGE,
  D173 V1), called through `parseExprAt` ([[FILE-PARSER-EXPRS]]) with the
  enclosing bindings in scope: interpolations, brace-only attribute values and
  `@event` values (`buildAttr`, with handler options), the
  `{#if}`/`{:else if}`/`{#unless}`/`{#case}` headers (`parseBlock`), `{:when}`
  value lists (`splitWhenValues`, top-level commas only), and the `{#for}` header
  (`parseForHeader` → `peelForCounter`/`splitForIn`), which splits
  `item in collection, i` or `a...b, x` and hands each piece to `expr`. This file
  never reads inside an expression; a `|` is rejected by `expr.Parse` itself.
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
`depth.go` (`OverNestingDepth`, D164 — a token-level nesting scan for the
playground that skips void start tags and stray void closers, so for a
well-formed template it counts exactly the AST's containers) and `inlinesvg.go`
(`ScanSVGFile`, D46 — skips a leading UTF-8 BOM, with error positions kept in
file coordinates). [[TEST-COMPILER-PARSER]] covers both.
