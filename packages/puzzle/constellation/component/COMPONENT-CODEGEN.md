---
name: Render-function codegen
status: verified
connections:
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ESBUILD-PLUGIN
  - FILE-CODEGEN
  - FILE-CODEGEN-EXPRESSIONS
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D62-HANDLER-CACHING
verified_at: '2026-09-25T10:47:50.423Z'
verified_sha: 5c21245a984c2fe5c86abf097189af44266f3b13
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: state
    text: >-
      `ScopedCSS(filename, styles)` now owns the D59 `@scope ([data-<scopeId>]) { … }` wrapper text
      next to `ScopeID`, which derives the id. The esbuild plugin calls it during a real build and
      the playground WASM compiler calls it in the browser (D164), so the two cannot drift; the
      emitted bytes are unchanged.
  - kind: gotcha
    text: >-
      Whitespace ([[DECISION-D168-TEXT-RUN-WHITESPACE]], the merged D173 V10 rule; the package doc
      in codegen.go states it). `processChildren` classifies ONE children list: each coalesced run
      learns whether each edge borders a sibling node (`leftSibling`/`rightSibling`, any non-text
      node) or the parent's edge, and `buildTextRun` puts one space back at every stripped edge
      except a parent edge. `<pre>`/`<textarea>` bodies are preserved through the `preserveWS`
      compiler counter, under which `buildTextRun` emits every Text node verbatim. Every walker that
      descends into an element's children and calls `processChildren` must raise it for those two
      tags — today `emitElement` and `staticSubtree` (staticcache.go) — or the static-cache
      look-ahead counts a different number of text vnodes than emission produces. `preservedBody`
      drops the one newline after the start tag (never from a `{#raw}` first child), and
      `forBodyRoot` zeroes the counter for the loop body's own list, since a loop body is one root
      element and cannot hold text.
  - kind: gotcha
    text: >-
      Three lists must move together, and two tests hold them: `codegen.LibraryFunctionNames`
      (lower.go), `check.libraryFunctionSignatures` (the puzzle check shim;
      `TestLibrarySignaturesMatchCodegen`) and `LibraryFunctions` in `types/index.d.ts`; the
      runtime's `STANDARD_FORMATTERS` + PuzzleKit-only names in client-runtime/formatters.js are the
      same 21. `thisMsg` in markup.go must stay word-for-word equal to `expr.msgThis` in puzzle-lang
      (the parser rejects `this` first; codegen's copy is the safety net). `HandlerForms` is the one
      definition of an @event value's own calls, shared by the lowering, `checkHandler` and the
      usage scan's `plugin.handlerOwnCalls` — a second copy would let the scan count a view handler
      as a library call.
  - kind: state
    text: >-
      D176 P2 (PR #167) and P4 (PR #171): the string resolver (`resolveExpr*`, `resolveValueScan`,
      `resolveChain`), `datalang.go`, `sizeSteps`/`__z`, `jsGlobals`/`jsKeywords`, the regex/number
      scanners and the resolver-vs-LexSkip differential test are gone; `expr.go` keeps only small
      lexical helpers (`isJSIdentifier`, `startsWithObjectLiteral`). Codegen still uses
      `parser.LexSkip`, for the `<script>` token stream only (classname.go, scriptcollide.go). Every
      changed golden across the 697-file corpus differed only in handler-argument `?.` guards and
      `{#unless}` parens.
---

# Render-function codegen

Transforms the parser AST into one ES module: the user's script bytes, compiler
imports, and `ClassName.prototype.render = function () { … }`. The user class
body is never rewritten. Class extraction is LexSkip-aware and requires a real
named `export default class … extends …` declaration. A script-less inline
component ([[DECISION-D173-CORE-SEMANTICS]] V15) gets a synthesized class whose
`data(params, props)` returns `props`, so its template reads its props by bare
name exactly as a scripted component's `data()` would expose them; a script-less
view or layout keeps the empty class.

The `<script>` body is tokenized ONCE per compile (`tokenizeJS`, scriptcollide.go)
and the one stream feeds all three consumers that lex those bytes: class-name
extraction, the import-collision warning scan, and the reserved-binding check.
Tokens carry a `comment` bit because the consumers disagree about opaque units —
a comment is whitespace to the class-keyword adjacency rule
(`export default /* x */ class Foo {}` is a declaration) while a string or regex
breaks it, and the binding scans treat every opaque unit alike. The
reserved-binding check covers what the compiler **declares** as well as what it
imports: `ViewNode`, `SLOT_TAG`, `SNIPPET_TAG`, `PORTAL_TAG`, `__s`, `__l`,
`__e`, `__r` and the `{#svg}` shared-asset locals, plus the `__L<n>` list-block
meta consts a template with an item-form `{#for}` hoists to module scope. Each
produces a positioned error naming the emission and why *this* file makes it.
`parser.LexSkip` serves only this script stream; template expressions never
pass through a text scanner.

**Names in the script are Unicode JavaScript identifiers**
([[DECISION-D176-EXPRESSION-LANGUAGE]] rule 8). Every scan here that reads a
name uses `jsident.IsIDStart`/`IsIDContinue`, the rule the expression lexer and
the template tag lexer share. `parser.LexSkip` consumes only the ASCII part of
an identifier run; `identRunEnd` and `startsNonASCIIIdent` (expr.go) carry the
run through non-ASCII `ID_Continue` runes or open it on a non-ASCII `ID_Start`
rune, so `tokenizeJS` reads `export default class Übersicht`, `概要` and
`Straßenkarte` whole (a name holding a non-ASCII letter is never a keyword, so
a `/` after it is division), and the collision scan matches `__d.金額` against
an imported `金額` and never reads the tail of `ö__d` as `__d`. A non-ASCII
space still separates tokens, so a no-break space before `extends` keeps
working. A script-less file's class comes from its filename
(`classNameFromFilename`): every rune that cannot continue an identifier
becomes `_`, and a `_` is prefixed when the first rune cannot start one or the
name is reserved, so `Übersicht.pzl` is class `Übersicht` and `a–b.pzl` is
`a_b`. **A class name the scan cannot read to its end is a positioned compile
error** at the name (`nameCut`, classname.go): when the byte after the
class-name token is `\` (a `\u` escape) or a non-ASCII character that is
not white space — U+30FB `・` in `データ・一覧` is `ID_Continue` from Unicode
15.1, newer than Go 1.24's tables — the render tail would bind to a cut name
(`データ`) and the module would crash on load. `puzzle check` reads the class
name back from the emitted render tail (`compiledClassName`), counting every
byte ≥ 0x80 as part of it. `classname.go` and `scriptcollide.go` have no FILE
card of their own; this card is their contract, and [[FILE-CODEGEN-EXPRESSIONS]]
binds the shared helpers in `expr.go`.

Mode comes from the app-relative path. Views/layouts preserve the
`<puzzle-view>` root; inline components require one render root and do not emit
a wrapper.

## Expressions: lowered from the AST (`lower.go`)


The template parser attaches a parsed expression tree
(`packages/puzzle-lang/expr`, [[DECISION-D176-EXPRESSION-LANGUAGE]]) to every
expression position — `ExprAST`, `ArgsAST`, `CondAST`, `ValuesAST`,
`CollectionAST`, `RangeFromAST`/`RangeToAST` — and codegen lowers those trees.
Nothing reads an expression's source string, except `startsWithObjectLiteral`,
a rule about the braces the author wrote. The lowering table is `lower.go`'s
header comment and is the contract:

- **Names** resolve from the tree. Arrow parameters (kept on the lowerer's own
  stack) shadow template bindings, which shadow the handler's `event`; every
  other name is a data root, `__d.<name>` — `event` outside a handler
  included, so `{ event.title }` is `__d.event?.title`. The **scopeMap** maps
  an in-scope binding to the JavaScript it resolves to: the empty string emits
  the name bare (a range variable, a snippet parameter, `ViewNode`), a
  non-empty value rewrites it — a lowered row's `todo` → `s.item`, its counter
  → `s.i`, a mangled `__pzl<name>`. An arrow parameter spelled like a row
  scope object is mangled so the row's locals stay reachable in the arrow
  body. Unicode identifiers and arrow parameters cannot be mis-prefixed.
- **`event` used both ways is an error.** `lowerer.ident` notes, on the
  `compiler`, the first place the template reads a free `event` as data (text,
  an attribute, a block header, a handler's conditional test) and the first
  place a handler uses it as the DOM event; `checkEventUses`, run after the
  render and the skeleton are emitted, reports a template with both as a
  positioned error at the handler's use that names the data read ("rename the
  field or prop"). A loop item or counter, a snippet parameter or an arrow
  parameter named `event` is its own binding and counts as neither, and a bare
  handler has no authored `event`. `puzzle check` runs the same codegen, so it
  reports the same error.
- **Guards** (D173 V4): every member step, index step and method call is
  written optional — `a.b` → `<a>?.b`, `a[i]` → `<a>?.[<i>]`,
  `a.m(x)` → `<a>?.m(<x>)` — in every position, handler arguments included, so
  a missing link yields `undefined` and prints nothing. A parenthesized chain in
  object position keeps its parentheses (`(a?.b).c` → `(<a?.b>)?.c`), and a
  number literal receiver is parenthesized. Two chains are written as authored:
  a handler's free `event` chain (the DOM event is not template data) and the
  compiler's own `ViewNode` import (the synthetic loop key).
- **Calls.** A bare call is a library function, written through the D43 guard
  as `(__f["name"] || __f.__missing("name"))(…)` (the name JSON-quoted, since
  registry keys are arbitrary strings); a method stays the same JavaScript
  method, guarded; the allowed globals (`Math.round(x)`, `Number(x)`,
  `Math.PI`) are verbatim, except that `Object.keys`, `values` and `entries`
  take their first argument as `(<arg> ?? {})` (`objectGlobalArgs`), so a
  missing value yields `[]` rather than JavaScript's `TypeError` and any other
  value reaches the global unchanged — the render target only. A file that
  calls a library function gets the `const __f` registry line.
- **Operators and literals** keep JavaScript's meaning; parentheses come from
  operator precedence, never from source spacing (`??` is never emitted mixed
  unparenthesized with `&&`/`||`); an arrow body that is an object is
  parenthesized; an object literal's shorthand expands (`{ s }` →
  `{ s: <s> }`) and only its values lower (D173 V8). An expression position
  that STARTS with an object literal is a positioned error — `{ {a: 1} }` is
  ambiguous with the interpolation braces.
- `LibraryFunctionNames` is the 21-name library the compiler knows (the 19
  standard functions plus `link` and `timeago`,
  [[DECISION-D174-STANDARD-FORMATTERS]]); `IsLibraryFunction` answers from it.

**Handler values** (`@event={ … }`, `lowerer.handler`): a bare name
`h` → `(event) => this.events.h(event)`; one call `h(a, b)` →
`(event) => this.events.h(<a>, <b>)` — the view's handler, never the library
(D176 rule 4); a conditional whose branches are each one of those or `null` →
`(<c>) ? <h1> : <h2>`; or `null`. `HandlerForms` returns an @event value's own
forms (the value, or both branches) and is the one definition the lowering,
`checkHandler` and the usage scan's `plugin.handlerOwnCalls` share. The DOM
parameter is named `__ev` when a binding owns `event`. The D62 caching
verdicts come off the same tree ([[DECISION-D62-HANDLER-CACHING]]): arguments
are lowered once into a scratch fact set recording their binding reads
(`refs`), data roots and library calls (`libRead`); `cacheable` is none of the
three, `rowCacheable` is binding reads only. A handler-valued conditional is
never cached — its condition is a guarded render-time read.

**The check target.** The same lowerer writes TypeScript for `puzzle check`
through `WriteCheckValue` / `WriteCheckEvent` (a `CheckWriter` maps every
authored token back to its `.pzl` offset): no added guards or `?? {}` defaults
(an authored `?.` stays; TypeScript 5.6+ reports a `??` whose left side can
never be nullish), a standard function call as `__puzzle_fn.name(…)` so the
shim's signatures type it (`check.libraryFunctionSignatures`, kept equal to
`LibraryFunctionNames` by `TestLibrarySignaturesMatchCodegen`), any other
bare call as `__puzzle_app_fn("name")(…)`, declared
`(name: string) => (...args: any[]) => any` — a call, not an index signature
on `__PuzzleFunctions`, so an app function type-checks under
`noUncheckedIndexedAccess` — a method call with an arrow argument taking its
receiver through `__puzzle_check_list(…)` so an untyped receiver gives the
arrow `any` parameters, and a bare handler written as the reference
`this.events.name` rather than a synthesized call. The shim also references the
`lib` files the method table needs (`es2021.string`, `es2022.array`,
`es2022.string`, …, and `es2023.array` from TypeScript 5.0; `toSorted` and
`toReversed` type only from 5.2).

## Checks before emission (`markup.go`, `presets.go`)

`checkTemplateExprs` walks the template and the skeleton before anything is
emitted, so the emitters can trust every tree they lower:

- **Markup placement** (D174): `raw` and `newline_to_br` may only be the
  outermost call of a text interpolation, with exactly one argument
  (`{ raw(post.body) }`); anywhere else — nested, an attribute value, a prop, a
  marker argument, a condition, a `{#for}` header, a handler argument — is a
  positioned error at the call. A markup interpolation is also an error inside
  a raw-text element (`<script>`, `<style>`, `<textarea>`, `<title>`,
  `<noscript>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`, `<plaintext>`)
  and in foreign content (an `<svg>`/`<math>` subtree down to an SVG
  `<foreignObject>`). The walk starts at the root element, so `<puzzle-view>`
  attributes are checked, and it carries the surrounding context through a
  component's children and snippet bodies; only a `<Portal>` resets it.
- **Literal presets** (`presets.go`, `checkLiteralArgs`): a string-literal
  second argument to `date`/`time`/`datetime` that is not `short`, `medium`,
  `long` or `iso` draws a positioned build **warning** (`c.warn`; a retired
  preset name, `'date'`, says to call that function instead), and so does a
  string-literal `in_timezone` zone that cannot be a zone id (a space, an
  empty string, a leading digit). It is a warning, not an error, because an
  app may register its own function under any of those names, and the
  compiler cannot see which presets or zones that one takes. A dynamic
  argument stays the runtime's development error.
- **`this`**, as a safety net behind the parser, with the parser's exact
  message (`thisMsg`).
- **The handler/library collision warning** (`checkHandler`): an `@event`
  whose own call names a library function draws a positioned, non-fatal
  warning (`c.warn`), since that name means the library everywhere else.

A markup interpolation is lowered by `emitMarkup` to
`new ViewNode('#html', { value })` (`br: true` for `newline_to_br`): the
argument lowers like any value, takes the `displayValue` coercion, and the
markup name never reaches `__f`, so a markup-only file emits no `const __f`
line. It is a non-text sibling under D168 (`processChildren` flushes the run and
sets `leftSibling`, exactly the element arm), counts one slot in
`condStaticLen`, and is dynamic to the static cache.

A second out-of-band diagnostic family (D82, `a11y.go`) walks the fresh template
+ skeleton ASTs before `{#svg}` resolution and warns — never errors — on five
conservative accessibility mistakes (img/input-image `alt`, iframe `title`, `a`
`href`, static positive `tabindex`); any static/dynamic/mixed attr counts as
present, and generated JS stays byte-identical.

## Emission

Emission covers host/component vnodes, coalesced text/interpolation, library
calls, dynamic/mixed attrs, events, slots, snippets, portals, refs, islands,
inline SVG, conditionals/case, and item/range loops. `{#unless c}` lowers its
parsed `!` over the condition, parenthesized as precedence requires. Markers
emit `new ViewNode(SLOT_TAG)` with optional `name`, per-render `args`, and a
lazy `fallback: () => [ … ]` thunk carrying the fallback body (D141): it is
compiled in the enclosing scope like any child list but runs only when the
position renders its fallback, so a filled marker never evaluates it. Caller
`<Snippet>` declarations emit `SNIPPET_TAG` metadata vnodes: their ordered
`params` plus a fresh `fn({ ...params })` closure whose body keeps caller scope
while parameters shadow it. `<Portal>` (D144) emits one `PORTAL_TAG` vnode
carrying the teleported children through that same child-emission path; a
component template whose ROOT is a `<Portal>` is a positioned error steering to
a wrapper element. **The injected import line is built per file from what the
file actually needs** — that is the tree-shaking contract, not a tidiness
preference: `ViewNode` always, `SLOT_TAG` when a marker is present,
`SNIPPET_TAG` when a Snippet is present, `PORTAL_TAG` when a portal is,
`displayValue as __s` when an interpolation coerces for display,
`listRows as __l` when the file lowers at least one item-form `{#for}`,
`loopItems as __e` when it emits an item-form loop as `.map`, and
`loopRange as __r` when it emits a range loop with a non-literal bound (in that
order). A runtime module reachable only through such an import is absent from
an app whose templates never emit it, which is why `views/listBlock.js` must
never be imported from inside `client-runtime/` — see [[FILE-LIST-BLOCK]].

**The loop domain is guarded** (D173 V12): a `.map` item loop iterates
`__e(<coll>).map(…)`, and a range iterates `__r(<from>, <to>).map(…)` (a
counterless range maps over `__i`, which is its generated key), so a missing
collection or a non-list loops zero times — with a dev warning for a non-list —
rather than throwing; `listRows` applies the same `loopItems` normalization for
lowered sites. The collection is any expression
(`{#for t in todos.filter(t => !t.done)}`). A range whose bounds are both
integer literals cannot be missing or fractional, so it is constant-folded — an
array literal for up to 16 numbers (`{#for 1...3}` → `[1, 2, 3].map(…)`),
`Array.from({ length: n }, …)` beyond, `[]` for an end below its start — and
imports no `loopRange`.

## List blocks (`listblock.go`)

**Item-form loops lower to persistent list blocks**
([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]). The `.map(…)` becomes
`__l(this, owner, id, coll, (s) => …, __L<id>)` in place, with the same
surrounding layout — first argument the view, second the owner the rows hang off
— and the site's static facts travel in a module-scope
`const __L<id> = { key, counter?, ctrl?, roots?, fields?, deep?, volatile? }`
emitted after the injected import line — non-default fields only, in a fixed
order, so the common site is one short const. The key function is hoisted: the
synthetic key is `(todo) => ViewNode.keyOf(todo)`, and an explicit `key=` is
lowered against the arrow's own parameters (the item, and the counter only when
the key reads it). A key that reads a data root or calls a library function
reads `__d`/`__f`, which do not exist at module scope, so that site keeps `.map`
entirely. The row root always carries the block's `key: s.k` (the author's `key`
attribute is dropped, having become the meta's function), loop locals resolve
through the scope map, nested loops take the enclosing row as owner and shadow
as `s1`, `s2`, … by depth, and `Class.__roots = […]` is stamped after the module
marker when any site carries a root mask — capped at 31 entries, past which a
site degrades to `volatile`.

Three body kinds are not lowered, and nothing nested inside one is lowered or
cached either: a `<Snippet>` body (stamped fresh per expansion, so a block keyed
by site id would be shared between stamps), a range `{#for}` body, and an
item-form body that fell back to `.map` because its explicit `key=` reads render
state. The last two are one rule, tracked as `mapDepth`: a non-lowered loop body
is emitted ONCE and evaluated per iteration, so a block or a cache slot taken
inside it is shared by every iteration — the same row vnode objects mounted at N
DOM positions, where a change to the source array reaches only the last one.

**Row facts come from the tree** (`exprFacts`, recorded as each expression is
lowered, and `absorb`ed into every enclosing lowered site). A bare record local
is on identity ONLY as a direct member access (`todo.text` — the field joins
`fields`) or as the whole expression (`{ todo }`, `todo={ todo }`). A deeper
path (`todo.author.name`), a computed member (`todo[k]`) or a method call on the
local or a path off it marks the site `deep`; so does any other whole-value use
— a function or method argument (`{ byline(post) }` hands the function the
record), an operand, a template-literal part, an array element or an object
value — the same path a relation read takes. A call to a clock-reading library
function (`clockFunctions`: `timeago`) marks the site `volatile`: an app
function is pure by contract, and a browser global is not a template read at
all. Facts are collected only inside a lowered loop body and never during a
look-ahead pass (conditional arity, `{#for}` root extraction), which re-lowers
expressions in a scope they will not be emitted in.

A read of a loop local owned by an ENCLOSING site marks the reading site
`volatile`, and every site between it and the owner with it. A nested block only
runs when its enclosing row runs, so "this body depends on what the outer row
supplies" is exact rather than an over-approximation, and a middle site that
cached its rows would otherwise never re-invoke the inner block. Handler
ARGUMENTS contribute no row facts beyond their data roots: they are re-read at
fire time off the live row scope.

Because the row scope objects are named `s`, `s1`, …, an authored binding
spelled the same way is mangled to `__pzl<name>` wherever it would stay BARE
inside a lowered body — a range counter, a non-lowered loop's item or counter, a
`<Snippet>` parameter, an arrow parameter — and its reads are rewritten through
the scope map like any loop local. (A snippet still declares its AUTHORED
parameter name in `params` and destructures it to the mangled local.) The row
scope names themselves never move: `s` is the byte contract in the todos
fixtures. This is the same mechanism that renames the DOM event parameter to
`__ev` on collision.

## Static subtrees and handlers

**Maximal static subtrees are cache sites** (`staticcache.go`): a subtree whose
every vnode has only static attributes (`ref`, `key`, `island` and `flip`
included — per-instance stable — plus `@event` values the D62 rule already
caches), literal text and static element children emits as
`(this.__c[n] ??= new ViewNode(…))` at view level or `(s.c[n] ??= …)` inside a
row, so it is allocated once per owner. The threshold is three or more vnodes —
**or a STATIC `island` element's children array at any size**, since
[[DECISION-D44-DOM-ISLANDS]] seeds those children once at mount and forbids the
patcher from ever reconciling them again, so rebuilding them is pure waste
however small the seed is. The seed must still be static: `??=` is per view
instance (or per row), while D44 re-seeds an island from the template on a
key-reset or hide/show remount, so a cached DYNAMIC seed would hand every later
mount the first render's values. Excluded: anything inside an already-wrapped
subtree (only the maximal one is cached), snippet bodies (no owner to cache on),
non-lowered loop bodies (the `mapDepth` rule above — one slot shared by every
iteration), a subtree holding a controlled `value`/`checked` (the runtime
re-asserts those against the live DOM every pass), and the render root, which
the root emitters never route through the wrapper. The wrapper is a pure
prefix on the subtree's first line with a `)` suffix on its closing line, and
the prefix counts toward `startCol` in the `attrsMultiline` width decision, so
a wrapped element wraps its attributes exactly as the fixture does.

Data-independent event sites cache one closure per instance in `this.__h`,
stabilizing DOM listeners and callback props. A site inside a lowered loop whose
arguments read only that loop's locals caches on the **row scope** instead —
`(s.h<n> ??= (event) => this.events.x(s.item))`, counted per site — so the
closure is identity-stable across renders and reads the row's current item at
fire time; a capture of a range-loop variable or a snippet parameter stays
fresh, because those bindings are re-created per iteration or per expansion.
Sites whose arguments read model data or call a library function keep fresh
closures so their captured values stay correct, and the roots they read count
toward the enclosing loop site's mask. Modifiers remain encoded in vnode
attribute names for ViewManager to apply.

## Two-way binding, conditional arity, inline SVG


Implicit two-way binding ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]) lives in
`binding.go`: `classifyBindExpr` reads the value's tree and accepts exactly an
`Identifier` or a non-computed, non-optional `Member` on one (a keyword literal
and `this` never classify; `event` classifies like any field name, so
`value={ event.title }` two-way binds; a bare loop variable never classifies, a
loop-var-rooted member path does; a call, an operator or a deeper path never
does, so `value={ capitalize(name) }` stays one-way). `x.size` classifies like
any field. `detectAutoBind` applies the element-level conditions (form-control
tag, no author `@input`/`@change`, no static `readonly`/`disabled`, no
`multiple` on a `<select>`, static classifiable `type`). Both `attrsMultiline`
and `emitAttrs` consume it — inline SVG calls that pair directly — appending
`'@<event>:bind': this.__bind(target, field, spec)` after the authored attrs.
The synthesized attr counts toward the width trial (layout stays deterministic)
and consumes no `__h` site index; `attrKV` runs twice per attr, so a counter
there would drift every golden. Non-classifying templates emit byte-identically.
Inside a lowered row the bind target resolves through the same scope map, so a
member path rooted at the loop variable writes to `s.item` — the live record,
not a render-time copy. A member-path target is emitted as `root ?? 0`
(`this.__bind(__d.profile ?? 0, 'name', 'v')`): `__bind`'s `target == null`
branch belongs to the bare-local form (`this.__bind(null, 'draft', 'v')`), so a
missing root must never reach it — it would write the field as a stray
top-level local — and a primitive target already returns the inert one-way
handler. The bind attr name is matched case-SENSITIVELY
(`value`/`checked`), because the runtime's property-write lookup is; a
`VALUE={ x }` spelling stays a plain one-way attribute rather than a bind the
runtime would never honor.

Conditional branches are arity-stabilized when occupancy is provably fixed.
`if`/`unless`/`case` compute their maximum static child count recursively and
pad shorter/implicit-empty branches with `new ViewNode('#')` — but only when
every branch is stable. An item-form loop (its row key can resolve to null →
unkeyed positional rows), a range loop whose body root carries an
explicit author `key`, or a slot marker (runtime expands it to 0..N nodes)
makes the whole conditional emit unpadded, byte-identical to the pre-padding
form — padding there could pair a placeholder against a real trailing sibling
and remount it. A generated-key range loop stays stable and counts as zero
slots. Balanced branches emit unchanged.

Inline SVG reads one app asset, validates a literal root, emits an island SVG
vnode, and registers the file with esbuild watch inputs. Root attrs from the
asset file are authored literals, never framework directives: every root attr
is stamped literal-name, reserved names (`ref`, `island`, `key`, `flip`) are
dropped before emission, an `@name` decodes through the `@@name` escape as a
plain DOM attribute, and a literal `key` on the asset root does not suppress
the row key a `{#for}` gives its body root. The read + scan is
memoized per absolute path in an optional build-scoped `SVGCache`
(`Options.SVGCache`), which the esbuild plugin also shares with its shared-asset
virtual module loader — so an icon used at N sites across M files and three
passes is read and parsed once, not 3N+1 times. The scan is NOT skipped in dedup
mode even though `emitRawSVG` discards the attrs there: "valid" is defined by the
scan, and a `<div>` root must still fail the .pzl compile with a ParseError
positioned inside the SVG. Memoized scans hand out a COPY of the attr slice —
`forBody` rewrites the root's `key` attribute, which would otherwise write
through into every other use site. Scoped styles share a
stable app-relative path hash with the plugin's `@scope` wrapper.

## Tests

Golden tests byte-compare focused fixtures plus the canonical todos output and
syntax-check emitted JavaScript; `expr_methods` and `expr_handlers` pin the
method and handler lowering. `expr_test.go` pins the lowering table,
`presets_test.go` the literal preset/zone warnings, `markup_call_test.go` and
`markup_test.go` the markup placement, `row_facts_test.go` the tree-derived row
facts, `handler_cache_test.go` and `event_handler_test.go` the D62 verdicts and
handler forms. The conditional-arity suite pins nested and unequal branch
behavior plus the stability gate; `listblock_test.go` and `static_cache_test.go`
pin the lowering — item/explicit-key/counter/nested/conservative meta, the
`listRows as __l` import appearing only for a file that lowers a site, the
`mapDepth` exclusions, the row-scope shadow mangling, the cache threshold, the
static island-seed case and every exclusion — `core_semantics_test.go` pins the
D173 value rules (the member guard, object-literal arguments, the loop-guard
imports and the literal-range fold), and the todos fixtures remain the byte
contract the emitter is matched to, not the other way round.
`classname_test.go` pins the script's names: `TestExtractClassName` (Unicode
class names, a no-break or ideographic space before `extends`, and both
truncation-guard inputs), `TestClassNameFromFilename`, and
`TestCompileUnicodeClassName` / `TestCompileUnicodeComponentTags`, which compile
Unicode views and component tags and run `node --check` on the output;
`scriptcollide_test.go` pins the token stream (`TestTokenizeJSUnicodeNames`,
`TestScriptImportBindings`) and the collision scan
(`TestCollisionForUnicodeDataName`). The check emitter's own tests live in
`compiler/internal/check` (`TestUnicodeClassNameReachesTheWrapper` among them).
