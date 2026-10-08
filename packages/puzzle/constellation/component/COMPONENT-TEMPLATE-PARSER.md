---
name: Template parser
status: verified
connections:
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
verified_at: '2026-09-25T10:47:50.423Z'
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
---

# Template parser

HTML-aware lexer and recursive-descent parser for `.pzl` files, in
`packages/puzzle-lang/parser` (D172; the compiler imports it through
`replace => ../puzzle-lang`). It returns a positioned AST or an error list, never
partial output. Its FILE and test cards live in the `puzzle-lang` plan (FILE-PARSER,
FILE-PARSER-SECTIONS, FILE-PARSER-SCANNER, FILE-PARSER-SLOT, TEST-COMPILER-PARSER);
this card stays here as the behavioral contract because ~60 cards connect to it. The
template grammar itself is [[DOC-SPEC-TEMPLATE]] / [[DOC-TEMPLATE-SYNTAX]].

## Sections

`SplitSections` finds one `<puzzle-view>`, optional `<script>` (absent/`js`/`ts`,
opaque bytes), `<style>` (only bare `scoped`) and `<puzzle-skeleton>` (only a static
integer `min-duration`). Close scans are quote/comment/template/interpolation aware. A
`{#raw}` span is stepped over whole ([[DECISION-D150-RAW-TEMPLATE-BLOCK]]) using the
lexer's own `isBlockRawOpen`/`scanBlockRaw`; a close tag seen inside a skipped span is
only a fallback, so a `{#raw}` missing `{/raw}` still splits at the real close tag.

**Accepted gotcha:** `findTemplateClose` is quadratic on thousands of unbalanced plain
`{` (each `scanBraceGroup` fails at EOF, then the loop advances one byte) — ~210 ms for
4,000 `{ `, same in the eslint/prettier ports. Such a file is already a compile error.

## Lexer and nodes

The lexer emits elements/components, text, interpolation, if/unless/else-if, case/when,
item/range for, and marker nodes. Template comments are erased (`{## … }` by brace
depth; `{#comment}…{/comment}` raw and nestable). Raw blocks keep their body as one
token: under script/style the parser emits one literal Text node; elsewhere a nested
brace-disabled HTML lexer builds ordinary nodes with raw-flagged text and static,
literal-name attrs (never events/directives; `{#svg}` roots get the same bit). Raw
blocks don't nest and are rejected in attribute values. The synthetic root records that
a raw block was parsed, for D89's `@` shim.

**Braces inside nested `<style>`/`<script>` elements are template grammar** —
`.a > .b { color: red }` is an interpolation and fails as an expression error. Authors
escape them (`\{ \}`).

## Expressions

The parser owns each position's structure (where a brace group ends, header shapes,
`{#for}` forms, `{:when}` lists); `packages/puzzle-lang/expr`
([[DECISION-D176-EXPRESSION-LANGUAGE]]) owns everything inside one expression.

- `scanBraceGroup` (scan.go) is the one balanced scanner, skipping strings, regexes and
  comments via `LexSkip`; `splitTopLevel`/`topLevelIndex` peel a `{#for}` counter, a
  range's `...` and `{:when}` lists.
- **Each position is parsed once** by `expr.Parse(src, base, opts)` (`parseExprAt`) and
  the tree stored beside the raw string (`ExprAST`, `CondAST` — `{#unless}` is a
  `Unary !` —, `ValuesAST`, `CollectionAST`, `RangeFromAST`/`RangeToAST`, marker
  `ArgsAST`, every part of a mixed attr). Errors are `ParseError`s at the expression's
  token (block headers carry `ValPos`); node positions are file coordinates, which is how
  codegen and `puzzle check` place later errors.
- `expr.Options{Handler, Bindings}`: `Bindings` are the enclosing `{#for}` item/counter
  and `<Snippet>` parameter names (`bind`/`unbind`, slices capped so a later bind can't
  write into one); calling a binding is an error. `Handler` (an `@event` value) makes the
  free name `event` the DOM event and lets the handler's own call name a view handler.
  Elsewhere `event` is an ordinary data name.
- A `|` anywhere is expr's positioned "`| name` pipes were removed" error. `this`,
  `window`/`document`/`globalThis` as a data root, and anything outside the grammar are
  expr errors. A leading object literal is rejected by codegen, not here.
- `parseForHeader`: a bare identifier on the left of a range (`{#for i in 1...5}`) is a
  positioned error steering to `{#for 1...5, i}`.
- **Every literal scanner clamps its escape skip at `len(s)`**: an unterminated literal
  must return exactly `len(s)` (callers slice `s[i:end]`, index `s[end-1]`); unclamped, a
  file ending in a backslash panicked the build.

**`LexSkip` division vs. regex (`lexskip.go`)** — shared with the `<script>` reader
(`findScriptClose`) and codegen's `tokenizeJS`, which must keep real regexes opaque. A
`/` after a token that ends an expression is division: a digit, `.`, `)`, `]`, `}` and
every byte ≥ 0x80 (`LexPlainEndsExpr`); ASCII letters directly after a byte ≥ 0x80 are a
name's tail, never a keyword; `of` is not in the regex-preceding keyword set. Accepted
gotcha: in a `<script>`, a regex right after `...` or `for (x of` reads as division
(matters only if it holds a quote, backtick or close tag). **The eslint/prettier
`split.js`/`lex.js` ports must mirror all three rules.**

## Attributes and markup

- Attributes are static, dynamic, mixed, event, valueless or a standalone `SpreadAttr` (`{...expr}`). A spread stores one `ExprAST` with its source position; the expression grammar itself still rejects spread. Non-event names with `:`
  are reserved unless the prefix is `xml`/`xlink`/`xmlns`; `checkAttrNamespace` runs at
  the NAME in both attribute loops, before the `=` branch, so valued and valueless forms
  reject alike. Event modifiers: `prevent`, `stop`, `once`, `outside` on any event; key
  filters keyboard-only. Attribute names may carry non-ASCII letters.
- Also enforced here: static islands, literal inline SVG roots/paths (`ScanSVGFile`
  skips a BOM, positions in file coordinates), list identifiers/keys, unique static refs.
- **Void elements** (`voidElements`: `area base br col embed hr img input link meta
  source track wbr`, exact lowercase) close at the start tag; `<br>`, `<br/>`, `<br />`
  are the same AST. A closer for one (`</input>`) is a positioned error
  (`checkCloser`). Holds inside `{#raw}`; `<Input>` is a component. `OverNestingDepth`
  skips void tags.
- **Tag names** follow JS identifier rules past ASCII (`startsTagName`/`tagNameEnd`,
  `jsident`); `$` never belongs to one. A tag is a component when its first character is
  NOT an ASCII lowercase letter (`isComponentName`) — `<Card>`, `<概要>`, `<_foo>` are
  components, `<straße-karte>` is a custom element
  ([[DECISION-D167-COMPONENT-FAMILIES]]). `checkComponentName`, right before the single
  `*Component` construction site, requires `Ident('.'Ident)*` (`$`-free segments); a
  dotted name starting with a marker name (`<Slot.Foo>`) gets a steering error. Not
  checked inside `{#raw}`.

## Runtime component selection (D180)

`parser/component.go` validates the reserved `<Component>` tag while retaining `*Component{Name: "Component"}` in the AST. A required expression-valued `is` is the only selector; missing, valueless, string, number, boolean, template-literal or duplicate `is` steers, including non-component literals inside braces. Nullish selectors remain valid. An authored `flip` attribute is a positioned error steering to a wrapping keyed element. Every other attr is a normal component attr, including `name`, `from` and standalone spreads. `Component.*` is a reserved family error; the compiler owns user filename/import rename diagnostics. The tag is forbidden in islands like every component. The `is` module scope and normal default-slot semantics are compiler/runtime contracts in [[DECISION-D180-COMPONENT-SLOT]] / SPEC §67.

## Composition markers

`<Children>`, `<Slot>` (outlet), `<Slot name>`, `<Snippet>`, `<Portal>` are reserved
before component resolution (not inside `{#raw}`); semantics in [[DOC-SPEC-TEMPLATE]]
§24/§64. Parser-enforced rules:

- `<Children>`/`<Slot>` are self-closing or paired (body = fallback); a marker inside
  another marker's fallback is an error. Lowercase `<children>`/`<slot>`/`<portal>` and a
  lowercase `<snippet>` with `fits`/params are steering errors; `<template>` is HTML,
  `<Template>` a component.
- `<Portal>` is paired-only, takes no attributes (`to`/`name`/`ref` get specific
  messages), and is illegal inside an island or a fallback.
- `<Snippet fits="row" item>` is paired-only and legal only as a component invocation's
  direct child; `fits` is static, other attrs are bare parameters. **A snippet body is a
  composition leaf** (D166): markers and `ref=` are errors at every depth, including a
  `<Snippet>` on a component nested inside the body — `nestedSnippetBodyMarker` recurses
  through `*Component` on purpose (pinned in `snippets_test.go`).
- Slot names are static, non-empty, reserved-checked and unique per render path;
  exclusive `{#if}`/`{#case}` branches are separate paths (D173 V13, `walkBranches`).
  One marker inside a loop is legal (visited once). Named fills must be direct static
  `slot="x"` children.
- Components/markers are forbidden in islands; refs are forbidden on components,
  markers, roots, loops, skeletons and Snippet bodies.

## Errors

`ParseError` carries file and 1-based line/column at the actionable position. A second
`{:else}` is reported at the stray clause, not as an unclosed block. `OverNestingDepth`
(depth.go) is a token-level depth check for the playground WASM compiler (D164), whose
process can't survive the recursive parser exhausting the stack; native builds never
call it.
