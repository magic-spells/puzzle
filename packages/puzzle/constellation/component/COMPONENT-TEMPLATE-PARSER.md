---
name: Template parser
status: verified
connections:
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
  - DOC-SPEC-TEMPLATE
  - DOC-LANGUAGE-CORE
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D176-EXPRESSION-LANGUAGE
verified_at: '2026-11-01T19:25:08.617Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Template parser

HTML-aware lexer and recursive-descent parser for `.pzl` files, in
`packages/puzzle-lang/parser` ([[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]; the compiler
imports it through `replace => ../puzzle-lang`). It returns a positioned AST or an error,
never partial output. Its FILE and test cards live in the `puzzle-lang` plan; this card is
the behavioral contract, kept here because the decision cards that constrain it are here.
The grammar is [[DOC-SPEC-TEMPLATE]]; the expression grammar is [[DOC-LANGUAGE-CORE]].

## Entry points and host switches


- PuzzleKit: `SplitSections` → `ParseTemplate` / `ParseSkeleton` (or `Parse` / `ParseFile`).
- A host with its own file layout (Sites) lifts its own blocks — blanking them to spaces so
  offsets stay the author's — and calls `ParseMarkup(markup, at, filename, opts)`. The
  exported scanners in `host.go` (`ScanOpenTag`, `FindScriptClose`, `FindTemplateClose`,
  `ScanBraceGroup`, `AttrNames`, …) are the ones the parser uses, so a host splitter reads
  a file exactly as the parser will.
- **`Options`** (`options.go`): `Let` (`{#let}`, `let.go`), `Pipes` (threaded into every
  expression as `expr.Options.Pipes`), `SkipIslandCheck` / `SkipSlotCheck` /
  `SkipRefCheck` (a host that runs its own), and `MaxDepth` (ParseMarkup only, default
  `DefaultMaxDepth` 200; a token-count scan rejects deeper nesting before the recursive
  parser could exhaust the stack). **The zero `Options` is PuzzleKit's grammar exactly**;
  every PuzzleKit caller passes none.
- `OverNestingDepth` (depth.go) is the same guard for the wrapped PuzzleKit path; only the
  playground WASM compiler ([[DECISION-D164-PLAYGROUND-WASM-BOUNDARY]]) calls it.

## Sections

`SplitSections` finds one `<puzzle-view>`, optional `<script>` (absent/`js`/`ts`, opaque
bytes), `<style>` (only bare `scoped`) and `<puzzle-skeleton>` (only a static integer
`min-duration`). Close scans are quote/comment/template/interpolation aware and skip whole
opening tags (brace expressions are scanned before quote delimiters, so an expression
reusing the enclosing quote works). A `{#raw}` span is stepped over whole
([[DECISION-D150-RAW-TEMPLATE-BLOCK]]) with the lexer's own `isBlockRawOpen`/`scanBlockRaw`;
a close tag seen inside a skipped span is only a fallback, so a `{#raw}` missing `{/raw}`
still splits at the real close tag.

**Accepted gotcha:** `findTemplateClose` is quadratic on thousands of unbalanced plain `{`
(each `scanBraceGroup` fails at EOF, then the loop advances one byte); the eslint/prettier
ports share it. Such a file is already a compile error.

## Lexer and nodes

The lexer emits elements/components, text, interpolation, if/unless/else-if, case/when,
item/range for, and marker nodes. Template comments are erased (`{## … }` by brace depth;
`{#comment}…{/comment}` raw and nestable). A raw block keeps its body as one token: under
script/style the parser emits one literal Text node; elsewhere a nested brace-disabled
HTML lexer builds ordinary nodes with raw-flagged text and static, literal-name attrs
(never events/directives; `{#svg}` roots get the same bit). Raw blocks don't nest and are
rejected in attribute values. The synthetic root records `ContainsRaw`, for D89's `@` shim.

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
- **Each position is parsed once** by `expr.Parse` (`parseExprAt`) and the tree stored
  beside the raw string: `ExprAST`, `CondAST` (`{#unless}` is a `Unary !`), `ValuesAST`,
  `CollectionAST`, `RangeFromAST`/`RangeToAST`, each marker `Args` attr's `ExprAST`, every
  part of a mixed attr. Errors are `ParseError`s at the expression's token (block headers
  carry `ValPos`); node positions are file coordinates, which is how codegen and
  `puzzle check` place later errors.
- `expr.Options.Bindings` carries the enclosing `{#for}` item/counter, `<Snippet>`
  parameter and `{#let}` names (`bind`/`unbind`; slices capped so a later bind can't write
  into one); calling a binding is an error. `Handler` (an `@event` value) makes the free
  name `event` the DOM event and lets the handler's own call name a view handler; elsewhere
  `event` is an ordinary data name.
- With `Pipes` off, a `|` anywhere is expr's positioned "`| name` pipes are Sites theme
  syntax" steer; with it on, `x | f(a)` parses to the call `f(x, a)`. A leading object
  literal is rejected by codegen, not here.
- `parseForHeader`: a bare identifier on the left of a range (`{#for i in 1...5}`) is a
  positioned error steering to `{#for 1...5, i}`.
- **Every literal scanner clamps its escape skip at `len(s)`**: an unterminated literal must
  return exactly `len(s)` (callers slice `s[i:end]`, index `s[end-1]`); unclamped, a file
  ending in a backslash panics.

**`LexSkip` division vs. regex (`lexskip.go`)** — shared with the `<script>` reader
(`findScriptClose`) and codegen's `tokenizeJS`, which must keep real regexes opaque. A `/`
after a token that ends an expression is division: a digit, `.`, `)`, `]`, `}` and every
byte ≥ 0x80 (`LexPlainEndsExpr`); ASCII letters directly after a byte ≥ 0x80 are a name's
tail, never a keyword; `of` is not in the regex-preceding keyword set. Accepted gotcha: in a
`<script>`, a regex right after `...` or `for (x of` reads as division (matters only if it
holds a quote, backtick or close tag). **The eslint/prettier `split.js`/`lex.js` ports must
mirror all three rules.**

## Attributes and markup

- Attributes are static, dynamic, mixed, event, valueless or a standalone `SpreadAttr`
  (`{...expr}`, one `ExprAST`; the expression grammar itself still rejects spread).
  Non-event names with `:` are reserved unless the prefix is `xml`/`xlink`/`xmlns`;
  `checkAttrNamespace` runs at the NAME, before the `=` branch, so valued and valueless
  forms reject alike. Attribute names may carry non-ASCII letters.
- **Event modifiers** (`parseEventModifiers`, written order kept): `prevent`, `stop`,
  `once`, `outside`, `passive`, `capture` on any event; `passive` with `prevent` is an error
  in either order ([[DECISION-D187-PASSIVE-CAPTURE]]); key filters are keyboard-only.
- Also enforced here (unless an `Options` skip is set): static islands, literal inline SVG
  roots/paths (`ScanSVGFile` skips a BOM, positions in file coordinates), list
  identifiers/keys, unique static refs.
- **Void elements** (`voidElements`, exact lowercase) close at the start tag; `<br>`,
  `<br/>`, `<br />` are the same AST. A closer for one (`</input>`) is a positioned error
  (`checkCloser`). Holds inside `{#raw}`; `<Input>` is a component.
- **Tag names** follow JS identifier rules past ASCII (`startsTagName`/`tagNameEnd`,
  `jsident`); `$` never belongs to one. A tag is a component when its first character is
  NOT an ASCII lowercase letter (`isComponentName`)
  ([[DECISION-D167-COMPONENT-FAMILIES]]). `checkComponentName`, right before the single
  `*Component` construction site, requires `Ident('.'Ident)*` (`$`-free segments); a dotted
  name starting with a marker name (`<Slot.Foo>`) gets a steering error. Not checked inside
  `{#raw}`.

## `<Component>` (D180)

`component.go` validates the reserved tag and keeps it as `*Component{Name: "Component"}`.
A required expression-valued `is` is the only selector; missing, valueless, string, number,
boolean, template-literal or duplicate `is` steers, as do non-component literals inside
braces. Nullish selectors are valid. An authored `flip` is a positioned error steering to a
wrapping keyed element. Every other attr is a normal component attr, including `name`,
`from` and spreads. `Component.*` is a reserved family error; user filename/import
collisions are the compiler's. Selector scope and slot semantics:
[[DECISION-D180-COMPONENT-SLOT]] / SPEC §67.

## Composition markers

`<Children>`, `<Slot>` (outlet), `<Slot name>`, `<Snippet>`, `<Portal>` are reserved before
component resolution (not inside `{#raw}`); semantics in [[DOC-SPEC-TEMPLATE]] §24/§64.
Parser-enforced rules (`slot.go`, skipped by `SkipSlotCheck`):

- `<Children>`/`<Slot>` are self-closing or paired (body = fallback); a marker inside
  another marker's fallback is an error. Lowercase `<children>`/`<slot>`/`<portal>` and a
  lowercase `<snippet>` with `fits`/params are steering errors; `<template>` is HTML,
  `<Template>` a component.
- `<Portal>` is paired-only, takes no attributes (`to`/`name`/`ref` get specific messages),
  and is illegal inside an island or a fallback.
- `<Snippet fits="row" item>` is paired-only and legal only as a component invocation's
  direct child; `fits` is static, other attrs are bare parameters. **A snippet body is a
  composition leaf** ([[DECISION-D166-SNIPPETS]]): markers and `ref=` are errors at every
  depth, including a `<Snippet>` on a component nested inside the body —
  `nestedSnippetBodyMarker` recurses through `*Component` on purpose (`snippets_test.go`).
- Slot names are static, non-empty, reserved-checked and unique per render path; exclusive
  `{#if}`/`{#case}` branches are separate paths (D173 V13, `walkBranches`). One marker
  inside a loop is legal (visited once). Named fills must be direct static `slot="x"`
  children; a named slot forwarded through a call site is an error (only the default marker
  forwards, [[DECISION-D71-SLOT-FORWARDING]]).
- Components/markers are forbidden in islands; refs are forbidden on components, markers,
  roots, loops, skeletons and snippet bodies.

## Errors

`ParseError` carries file and 1-based line/column at the actionable position. A second
`{:else}` is reported at the stray clause, not as an unclosed block.
