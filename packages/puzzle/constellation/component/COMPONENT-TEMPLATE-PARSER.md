---
name: Template parser
status: verified
connections:
  - COMPONENT-CODEGEN
  - DOC-TEMPLATE-SYNTAX
verified_at: '2026-09-25T10:47:50.423Z'
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
notes:
  - kind: gotcha
    text: >-
      Nested <style> elements are legal template markup (verified during D113), but the template
      brace grammar applies inside them: in `.a > .b { color: red }` the brace group is an
      interpolation, and its body is parsed as an expression (D176), so it is a positioned
      expression error rather than CSS. Authors must escape the braces (`\{ \}`), which compiles
      correctly. Same applies to braces in nested <script> bodies. Docs/error-message improvement
      candidate.
  - kind: state
    text: >-
      The package also exports `OverNestingDepth` (packages/puzzle-lang/parser/depth.go, D164): a
      token-level scan that reports whether a template nests past a caller-supplied limit, without
      building an AST. It exists for the playground's WASM compiler, whose process cannot survive a
      Go fatal error — the recursive-descent parser exhausts the stack on a pathologically deep
      source, so "parse it and then measure the tree" is not available there. Nothing in a native
      build calls it.
  - kind: gotcha
    text: >-
      "composition markers are positioned errors at every depth" in a `<Snippet>` body includes a
      `<Snippet>` hanging off a component invocation INSIDE that body — `nestedSnippetBodyMarker`
      recurses through `*Component` on purpose, so `<Snippet item><Card><Snippet cell>…` is rejected
      even though the runtime could stamp it. A snippet body is a composition LEAF (D166); nesting
      is expressed by extraction, and the error message says so. Do not "fix" the Component
      recursion into an escape hatch — `snippets_test.go`'s "nested Snippet declaration" case pins
      it.
  - kind: state
    text: >-
      0.7.0 final review: `parseForHeader` no longer accepts an item-in binding on the left of a
      range. It checked for a top-level `...` BEFORE splitting `item in items`, so `{#for i in
      1...5}` parsed as a range whose from-bound was the string `i in 1`, compiled green, and threw
      `Cannot use 'in' operator` on the first render. A bare-identifier item on the left of a range
      is now a positioned error steering to `{#for 1...5, i}` (the counter always binds AFTER the
      range). Pinned in packages/puzzle-lang/parser/parser_test.go.
  - kind: state
    text: >-
      The parser lives in `packages/puzzle-lang` (module
      `github.com/magic-spells/puzzle/packages/puzzle-lang`, package `parser`, beside `expr`,
      `conformance`, `jsident` and `textutil`; D172), which `packages/puzzle/go.mod` requires
      through `require ... v0.0.0` + `replace => ../puzzle-lang`. Its code binding lives in that
      module's own constellation root (connected repo `puzzle-lang`; pass `repo=puzzle-lang`):
      FILE-PARSER, FILE-PARSER-SECTIONS, FILE-PARSER-SCANNER, FILE-PARSER-SLOT and
      TEST-COMPILER-PARSER, with paths relative to the module. This card stays in the framework plan
      as the behavioral contract — nearly 60 cards here connect to it, and plans cannot hold
      cross-plan connections — so it has no bound code in this plan.
  - kind: decision
    text: >-
      2026-09-28, Cory (decided with the D176 sub-decisions, though not part of the expression
      rewrite): the HTML void elements — `area base br col embed hr img input link meta source track
      wbr` — are accepted without a slash (`<br>`, `<input type="text">`), `<br/>` stays legal, and
      a closing tag for a void element (`</input>`) is the positioned error. Not built yet (D176
      P1b, its own small parser PR): today `parseElement` has no void list, so `<br>` opens a
      context that only `</br>` closes, and the mismatch error blames the parent's close tag (review
      finding R-LANG-BUGS-7). DOC-TEMPLATE-SYNTAX's `<input value={ x } readonly>` example compiles
      once it lands.
---

# Template parser

HTML-aware lexer and recursive-descent parser for `.pzl` files. It returns a
positioned AST or an error list; there is no partial/best-effort output.

`SplitSections` recognizes one `<puzzle-view>`, optional `<script>`, optional
`<style>`, and optional `<puzzle-skeleton>`. Scripts remain opaque bytes.
Section closing scans are quote/comment/template/interpolation aware, including
literal close-tag text inside template comments and skeleton bodies. Scripts
accept absent/`lang="js"`/`lang="ts"`; styles accept only bare `scoped`;
skeletons accept only a static integer `min-duration`.

The lexer emits elements/components, text, interpolation, if/unless/else-if,
case/when, item/range for, and marker nodes. Template comments are erased by the
lexer: inline `{## … }` uses brace-depth scanning and block
`{#comment}…{/comment}` discards raw, nestable content.

Raw blocks ([[DECISION-D150-RAW-TEMPLATE-BLOCK]]) reuse the comment block's
forward scan but preserve the body as one outer-lexer token. The parser owns the
needed parent context: under script/style it emits that span as one literal Text
node; elsewhere a nested brace-disabled HTML lexer builds ordinary element/text
nodes, their text flagged raw so codegen preserves its bytes verbatim.
Attribute tokens from that nested pass are static and every name carries a
literal-name bit, so none can become an event or directive; `{#svg}` asset
roots stamp the same bit on their root attrs. Raw blocks do not nest
and are rejected at attribute-value positions. Because their expanded AST is
otherwise indistinguishable from ordinary markup, the synthetic template or
skeleton root also records that at least one raw block was parsed; D89's usage
scan consumes that deliberately over-inclusive fact to retain the literal-`@`
client shim.

## Expressions


The template parser owns the structure of each expression position — where a
brace group ends, a header's shape, the `{#for}` forms, a `{:when}` list — and
the expression language, `packages/puzzle-lang/expr`
([[DECISION-D176-EXPRESSION-LANGUAGE]]), owns everything inside one expression.
`scanBraceGroup` (scan.go) is the one balanced scanner that finds a brace
group's end, skipping strings, regex literals and comments through `LexSkip`
and tracking nested braces, so `{#if x === '}'}` and an object literal inside
an argument scan correctly. The top-level splitters (`splitTopLevel`,
`topLevelIndex`) peel a `{#for}` counter, a range's `...` and a `{:when}` value
list with the same quote/depth awareness.

**Each expression position is parsed once**, by `expr.Parse(src, base, opts)`
(`parseExprAt` in exprs.go), and its tree is stored beside the raw string:
`Interpolation.ExprAST`, `DynamicAttr.ExprAST`, `EventAttr.ExprAST`,
`If.CondAST` (for `{#unless}`, a `Unary !` over the parsed condition — one AST
shape), `Case.ExprAST`, `When.ValuesAST` (one tree per value),
`For.CollectionAST` / `RangeFromAST` / `RangeToAST`, a marker's `ArgsAST`, an
inline if's condition and every part of a mixed attribute. An expression error
becomes a `ParseError` at the expression's own token position (block-header
tokens carry `ValPos`), with expr's message and note. Every node position is in
file coordinates, which is how codegen and `puzzle check` place later errors.

`expr.Options{Handler, Bindings, CallArgument}` carries what the position
knows. Every position passes `Bindings`, the names the enclosing `{#for}` items
and counters and `<Snippet>` parameters bind (`bind`/`unbind` in exprs.go; the
slice handed out is capped so a later bind cannot write into it): a binding
reads as a value, and calling one is a positioned error, so `t('k')` inside
`{#for t in …}` never reaches the library. An `@event` value adds `Handler`,
which makes the free name `event` the DOM event — its chain unrestricted by the
method table — and lets the handler's own call name a view handler even when a
binding shares its name. `CallArgument` (an arrow legal at the top level) is for
hosts and tests that parse one call argument alone; the template parser does not
set it.

**There are no formatter chains.** A `|` in any position is expr's positioned
error "`| name` pipes were removed — write `name(value)`; bitwise OR is not
available", so no position splits a chain and the AST has no chain fields. A
condition header, a `{:when}` value and a `{#for}` header are ordinary
expressions, and a display transform is a function call. `this`, a browser
global read as a data root (`window`, `document`, `localStorage`, …) and every
construct outside the grammar are expr errors at their token. A template
expression that starts with an object literal is rejected by codegen, not here.
Unicode names are accepted where the grammar accepts them: a binding like
`{#for größe in sizes}`, and snippet-parameter attribute names, whose first
character may be `@`, an ASCII letter, `_` or any letter, the rest adding marks
and digits (a bad character is named as itself, not by its first byte).

Every literal scanner in this package clamps its escape skip at `len(s)`. The
`j += 2` that steps over `\x` must not run past EOF on a literal whose last byte
is a backslash: the contract is that an unterminated literal returns exactly
`len(s)`, and callers slice `s[i:end]` and index `s[end-1]`. Unclamped, a `.pzl`
ending in `{/a\` returned `len(s)+1` and killed `puzzle build` with a Go panic
instead of a positioned "unclosed `{`" error. expr's own lexer reads through a
bounds-checked `peekByte` and reports an unterminated string or template
literal as its own positioned error.

## Attributes and markup

Attributes are static, dynamic, mixed, event, or valueless-static values.
Non-event names containing `:` are reserved unless their prefix is `xml`,
`xlink`, or `xmlns`; invalid namespaces fail at the attribute name's source
position. `checkAttrNamespace` runs in both attribute loops (element tags and
section tags) at the NAME, before the `=` branch — the valued and valueless
spellings must reject identically, and validating inside `buildAttr` reaches only
the valued one. Event names are exempt: the colon is their modifier channel, and
`parseEventModifiers` owns it. Parser helpers enforce event/modifier grammar
(generic modifiers: `prevent`, `stop`, `once`, and since D86 `outside` — valid
on any event; key filters stay keyboard-only), static islands, literal inline
SVG roots/paths, list identifiers/keys, and unique static refs. The HTML void
elements still need a self-closing slash (`<br/>`); accepting `<br>` is planned
(D176 P1b).

Component-name grammar ([[DECISION-D167-COMPONENT-FAMILIES]]): a capitalized
tag that survives marker resolution must be a valid member path —
`Ident('.'Ident)*`, each segment `[A-Za-z_][A-Za-z0-9_]*` — enforced by
`checkComponentName` immediately ahead of the parser's single `*Component`
construction site, so every classification path (template and skeleton bodies,
conditional/loop/case bodies, marker fallback bodies, Snippet and Portal
children) is covered. Any other capitalized name (a `-`, a `:`, an empty
segment) is a positioned compile error. A dotted name whose first segment is a
marker name (`<Slot.Foo>`) gets a steering error; the check does not run inside
`{#raw}`, and lowercase tags are untouched, so custom elements keep their
dashes. Dotted names are the component-family idiom — codegen emits them
verbatim as member expressions.

Composition grammar (D134/D141/D144/D166): `<Children>` is the default marker,
`<Slot>` is the router outlet, `<Slot name="x">` is a named marker,
`<Snippet>` declares caller-owned parameterized content, and `<Portal>` is the
teleport marker. These tag names are reserved before component resolution, and
none of the reservations apply inside `{#raw}`, where every tag is literal
sample markup. `<Children>`/`<Slot>` are
self-closing (no fallback) or paired — the body is fallback content, parsed
as ordinary template children, with a marker nested inside another marker's
fallback a positioned compile error; lowercase `<children>`/`<slot>`/`<portal>`
are positioned steering errors. Lowercase `<snippet>` with `fits` or bare params
steers to `<Snippet ...>`; lowercase `<template>` is always an HTML element and
capitalized `<Template>` is always a component invocation. `<Portal>` is
paired-only (it exists to carry the children it teleports), takes no
attributes — `to`/`name` get a named-outlets-not-supported message and `ref`
the render-target message — and cannot appear inside an island or inside a
marker's fallback body. A paired-only `<Snippet fits="row" item>` is legal only
as a component invocation's direct child; `fits` is static and every other
attribute is a bare parameter, which the body's expressions receive as
bindings. Its body is stamped output: component invocations are legal, but
composition markers and `ref=` are positioned errors at every depth. Slot names
stay static, non-empty, reserved-name checked, and unique per render path: the
mutually exclusive branches of one `{#if}`/`{:else}` or `{#case}` are separate
paths (D173 V13, `walkBranches` in `slot.go`), so each may declare the same
marker, while a marker after the block still collides with one inside it. Every
distinct marker AST declaration on one path is unique even when args-bearing;
one marker declaration inside a loop remains legal because validation visits
that site once. Call-site named fills must be direct static `slot="x"`
children, while default forwarding may appear inside a component invocation.
Components/markers are forbidden inside islands; refs are forbidden on
components, markers, roots, loops, skeletons, and Snippet bodies.

`ParseError` includes file and one-based line/column. Cross-nesting and
did-you-mean diagnostics report the actionable source position.
