---
name: >-
  D176 — The expression language: JavaScript-shaped, one closed grammar parsed in puzzle-lang, a
  method table, functions instead of pipes, evaluated in Go by Sites
status: building
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D175-TRANSLATIONS
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DOC-LANGUAGE-CORE
  - DOC-SPEC-TEMPLATE
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-FORMATTERS
  - RELEASE-V0-8-0
notes:
  - kind: deviation
    text: >-
      Two development warnings the decision named are not built in PuzzleKit. (1) §9 d / deviation
      1: a method call on a missing receiver (`x.trim()` with `x` missing) prints nothing with NO
      development warning — detecting it needs a runtime helper (or evaluating the receiver twice)
      that production would pay for, so P2 skipped it (PR #167 "Not in this PR"). (2) §4: no warning
      when a data field shares a library function's name — a bare read and a bare call never resolve
      to each other, so nothing is ambiguous at run time. The handler/library collision warning (§9
      c) IS built, twice over (compile-time in codegen `checkHandler`, runtime
      `warnHandlerShadows`).
  - kind: decision
    text: >-
      The two development warnings the deviation note above lists as unbuilt are resolved as design,
      not debt, and will not be built. (a) A method call on a missing receiver (`x.trim()` with `x`
      missing) prints nothing with no warning: a runtime warning cannot be free in production — it
      needs a helper or a second evaluation of the receiver on every guarded call — and the `?.`
      semantics are documented (deviation 1, D173 V4). (b) No warning when a data field shares a
      library function's name: a bare read resolves to data and a bare call resolves to the library
      (rule 4), so the two can never mean each other and there is no ambiguity to warn about. The
      handler/library collision warning (§9 c) is the one name-collision warning, because inside an
      `@event` value the same spelling really can mean two things.
---

# D176 — The expression language: JavaScript-shaped, parsed once, evaluated by both hosts

**Status: decided by Cory on 2026-09-28, sub-decisions included; building for
0.8.0.** Rule 7 (PR #163), P1 (PR #164), P2 (PR #167) and P3 (PR #168) are
built on `release/0.8.0`; P4, the corpus migration and the removal of pipes
and `.size`, is PR #171, in review; P5 and P6 are planned. The 0.8.0 tag waits
for P1–P5. D173, D174 and D175 state the language's semantics, function
library and translations in this card's terms. Two older questions remain
under *Open*.

## Context

D172 made Puzzle one language with two hosts: PuzzleKit compiles a template to
JavaScript that runs in the browser, and Magic Spells Sites renders it in Go at
request time. A template expression therefore has to mean the same thing in a
JavaScript engine and in Go, and Sites will not embed a JavaScript engine.
Cory: "we aren't going to run JS in Sites, it needs to be in Go."

Cory chose JavaScript's own expression syntax over a Puzzle-specific one:
"we're making the move to JS dot syntax for the same reason that Vue moved away
from the filter pipe syntax. The js has no learning curve and it makes the
syntax less complicated and more devs will expect to be able to drop js in the
brackets and just have it work." And: "I agree with Vue's logic to drop filters
… it'll essentially be js … people can still register custom filters like
{ specialFormat(product.title) } … we need to match this in Puzzle Lang for the
Sites side … we aren't going to run JS in Sites, it needs to be in Go."

The model is Angular's template expressions, not Vue's. Expressions look and
behave like JavaScript, but a closed grammar and a method table define them,
one parser reads them, and each host implements exactly that table: PuzzleKit
by lowering to JavaScript, Sites by evaluating in Go.

## Decision

### 1. One closed grammar, parsed once in puzzle-lang

The `expr` package in puzzle-lang (`packages/puzzle-lang/expr`: lexer, Pratt
parser, AST, method table, printer) parses every template expression into an
AST both hosts consume. The template parser calls `expr.Parse(src, base,
Options{Handler, Bindings, CallArgument})` once per expression position and
stores the tree beside the source string. Every node carries a file position,
so an error reports the same line:col in both hosts, and parsing is linear in
the source. Anything outside this grammar is a positioned compile error in
both hosts whose message names the construct and what to write instead.

- **Literals:** `'str'` and `"str"` with JavaScript's strict-mode escapes
  (`\xHH`, `\uHHHH`, `\u{…}`, line continuations; a raw line break, a legacy
  octal escape or a lone surrogate is an error); template literals
  `` `a ${expr} b` ``; decimal numbers (`1e3`, `0.5`; hex, octal, binary,
  BigInt, numeric separators, a leading zero and a name straight after a
  number are errors); `true`, `false`, `null`, `undefined`, `NaN`, `Infinity`
  (literals, never names); arrays `[a, b]`; objects `{ k: v, 'k': v, k }` (no
  spread, computed keys, methods or numeric keys).
- **Identifiers:** JavaScript `ID_Start`/`ID_Continue` (Unicode letters,
  digits and marks, `_`, `$`). Reserved words are rejected except `eval` and
  `arguments`, which read like any data field; `this` is rejected (rule 7);
  `event` is a handler-only name. `__proto__`, `constructor` and `prototype`
  are rejected as member names and object keys, because they reach
  JavaScript's prototype machinery, which a Go host's plain maps would not
  share.
- **Access:** `a.b`, `a?.b`, `a[expr]`, `a?.[expr]`.
- **Calls,** three kinds:
  - `name(args)` calls a function from the library (rule 4). A template
    binding — a `{#for}` item or counter, a `<Snippet>` parameter, an arrow
    parameter — is a value, and calling it is a positioned error, so
    `t('key')` inside `{#for t in …}` never reaches the library.
  - `a.m(args)` and `a?.m(args)` call a method from the table (rule 3); any
    other method name is a compile error that names the alternative
    (`sort` → `toSorted()`, `push` → `concat()`, `substr` → `slice()`,
    `getFullYear` → `date(v, preset)`, …). `.length()` is an error
    (`.length` is a property). A computed method call (`a[name]()`), a call's
    result called (`f(x)(y)`) and an optional call (`f?.(x)`) are errors.
  - the global namespaces: `Math.abs`, `ceil`, `floor`, `round`, `trunc`,
    `max`, `min`, `sign`, `pow`, `sqrt`; `Number(x)`, `String(x)`,
    `Boolean(x)`; `Array.isArray(x)`; `Object.keys`, `values`, `entries(x)`;
    `parseInt`, `parseFloat`, `isNaN`, `isFinite`. Globals are only ever
    called, except the readable constants `Math.PI` and `Math.E`; `Math` on
    its own is not a value, and `items.filter(Boolean)` says to write
    `x => Boolean(x)`. There is no `Date`, `JSON`, `Intl`, `Map`, `Set` or
    `fetch`; dates and JSON are the `date()` and `json()` functions.
- **Browser globals are not template data.** A read of `window`, `document`,
  `globalThis`, `navigator`, `location`, `console`, `localStorage` or
  `sessionStorage` as a data root is a positioned error: "`window` is not
  available in template expressions — read it in data() and pass the value".
  A binding or arrow parameter with that name, a call's callee and a handler
  value's own name are exempt.
- **Arrow functions** only as call arguments, with an expression body and
  plain parameters (no defaults, rest or destructuring): `x => expr`,
  `(x, i) => expr`; an object body is written `x => ({ … })`.
- **Operators,** with JavaScript precedence: unary `!` `-` `+`; `*` `/` `%`;
  `+` `-`; `<` `<=` `>` `>=`; `==` `!=` `===` `!==`; `&&`; `||`; `??`; `?:`;
  parentheses. `??` mixed with `&&` or `||` without parentheses is an error
  with the fix-it, as in JavaScript. Excluded: the bitwise operators,
  `**` (→ `Math.pow`), `in`, `instanceof`, `typeof`, `void`, `delete`, `new`,
  the comma operator, assignment, `++`/`--`, regex literals, comments,
  statements, `function`, classes, `await`/`yield`, tagged templates and
  spread.
- **There is no pipe.** A `|` anywhere is the positioned steer "`| name`
  pipes were removed — write `name(value)`; bitwise OR is not available".

### 2. JavaScript semantics, with two deviations both hosts implement

Everything in the grammar means what it means in JavaScript: truthiness, `+`
concatenating when either side is a string, `==` and `!=` as JavaScript's loose
equality on primitives (D173 V2; Go coerces primitives the way JavaScript
does), number-to-string conversion as JavaScript does it (`0.1 + 0.2`, `-0` →
`"0"`, `1e21`), `NaN` and `Infinity`, `?.` short-circuiting, and `??`. Two
deviations hold in both hosts:

1. **A member read never throws** (D173 V4): `a.b.c` on a missing path is
   `undefined` (nil in Go), which prints nothing. A method call on a missing
   value is guarded the same way: `x.trim()` with `x` missing is `undefined`
   and prints nothing (PuzzleKit draws no development warning for it).
2. **Printing is display, not expression semantics** (D173 V6): `null`,
   `undefined`, `NaN`, ±Infinity and dates print nothing, a list joins, and any
   other object prints nothing and draws a development warning.

### 3. The method table is the boundary

A method is callable only when the table (`expr/methods.go`, the table as
data) lists it. When the syntax fixes the receiver's type — a string, number,
boolean, `null` or `undefined` literal, a template literal, an array or object
literal, `Math.PI`, or a global call such as `Number(x)` or `Object.keys(x)` —
the method is checked against that type's list at parse time, so
`'s'.filter(f)`, `[1].trim()` and `Number(x).trim()` are errors in both hosts.
On a dynamic receiver (a data path) the name only has to be in the table;
PuzzleKit's `puzzle check` then type-checks it as the same JavaScript method,
and Sites checks the runtime type. The one exception to the table is a chain
rooted at `event` inside an `@event` handler (rule 7). Each entry is a
JavaScript method with a Go reimplementation that behaves exactly like it,
pinned by a conformance row. No entry mutates its receiver: there is no
`push`, `pop`, `splice`, `sort` or `reverse`, and `toSorted` and `toReversed`
cover display. The v1 table:

- **String:** `length`, `at`, `charAt`, `includes`, `startsWith`, `endsWith`,
  `indexOf`, `lastIndexOf`, `slice`, `substring`, `split(sep, limit)`,
  `replace(str, str)` (first occurrence), `replaceAll`, `trim`, `trimStart`,
  `trimEnd`, `toUpperCase`, `toLowerCase`, `padStart`, `padEnd`, `repeat`,
  `concat`. `.length` counts UTF-16 units in both hosts (Go through
  `unicode/utf16`). Not in v1: `localeCompare`, `normalize`.
- **Array:** `length`, `at`, `includes`, `indexOf`, `lastIndexOf`, `slice`,
  `concat`, `join`, `flat(1)`, `find`, `findIndex`, `findLast`, `filter`,
  `map`, `some`, `every`, `reduce(fn, init)`, `toSorted(cmp?)`, `toReversed`.
  A callback receives `(item, index)`; the third `array` argument is not
  passed. Not in v1: `entries`, `keys`.
- **Number:** `toFixed(d)` and `toString()` without a radix. Not in v1:
  `toPrecision`.
- **Boolean, `null`, `undefined`:** no methods (a call on a missing value is
  guarded, deviation 1).
- **Records and plain objects:** property access only; `Object.keys`,
  `values` and `entries` are the globals for iterating one.
- **Map and Set:** not in v1. `data()` can still return one for a `{#for}`,
  and `.size` is not special: it reads a field named `size` like any member.

### 4. Functions instead of pipes

A display transform is a function, called like one: `{ currency(price) }`,
`{ truncate(post.body, 120) }`; a chain nests: `{ b(a(x)) }`. The library
([[DECISION-D174-STANDARD-FORMATTERS]]) holds only the names that no
JavaScript method, operator or `Math` global covers, or that need the
framework — 19 standard functions both hosts ship: `round`, `currency`,
`percentage`, `number_with_delimiter`, `compact_number`, `pluralize`,
`capitalize`, `truncate`, `strip_html`, `strip_newlines`, `escape`, `raw`,
`newline_to_br`, `json`, `date`, `time`, `datetime`, `in_timezone` and `t`
([[DECISION-D175-TRANSLATIONS]]); plus `link` and `timeago`, PuzzleKit-only.
`round` stays because `Math.round` takes no places and `.toFixed()` rounds
the binary value and returns a padded string; `in_timezone` is standard
because nothing in the language re-expresses an instant in another zone.
`upcase`, `downcase`, `trim`, `strip`, `replace`, `join`, `abs`, `ceil` and
`floor` are not functions: `.toUpperCase()`, `.toLowerCase()`, `.trim()`,
`.replaceAll()`, `.join(', ')` and `Math.*` already say them.

- **Date presets.** `date(v)` defaults to the medium date, `time(v)` to the
  short time (`3:04 PM`), and `datetime(v)` to the medium date with the short
  time (`Sep 24, 2026, 3:04 PM`). A string-literal preset the library does not
  know, or an `in_timezone` literal that cannot be a zone id, is a positioned
  compile error in PuzzleKit; a dynamic one is a development error that
  renders the default.
- **An app registers its own functions** through the `formatters` config map,
  which keeps its name, and calls them bare, as Cory put it:
  `{ specialFormat(product.title) }`. `puzzle check` types an app function as
  `(...args: any[]) => any`, as it types an untyped `data()` value.
- **Resolution.** A bare call `name(…)` resolves to the library, so a data
  field is never callable, and a bare read `name` resolves to `data()`; the
  two never resolve to each other. An unregistered name is PuzzleKit's D43
  guard: the value passes through with a development error (with a
  did-you-mean, or the replacement for a removed name).
- **Inside an `@event` value** the handler's own call — the whole value, or a
  branch of its top-level conditional — names the view's handler, never the
  library; calls inside its arguments and its condition are library calls.
  Cory: "we should throw a warning if there are two with the same name", so a
  handler named like a library function draws a warning: at compile time for
  a standard or PuzzleKit-only name, and at mount in development for any
  library name, app-registered included.
- **`raw` and `newline_to_br` keep the markup-position rule** (D174): each may
  only be the outermost call of a text interpolation, with one argument;
  anywhere else is a positioned compile error.

### 5. One shared table; Sites switches entries off

The grammar, the method table, the global namespaces and the standard function
library are one shared table in puzzle-lang, and that table is the superset.
PuzzleKit accepts all of it, and Sites may switch entries off. Cory: "a lot of
these things might work in Puzzle Kit but then not be supported in Sites and
that's fine." Nothing outside the table compiles in either host, and an entry
Sites has switched off is a positioned error there that says so. That is a
restriction in D172's sense, never a redefinition: an entry means the same
thing wherever it is on. Functions are the one open end: an app (PuzzleKit)
or the platform (Sites) adds its own, and those join the library by name.

### 6. Dates: limited support

There is no `new` and no `Date` global, so a template cannot construct a date,
and a date value has no methods. Dates reach a template from `data()` or the
model and display through `date()`, `time()`, `datetime()` and `timeago()`.
The only operators a date value takes are `<`, `<=`, `>`, `>=` and binary `-`,
which coerce it to milliseconds in both hosts. Cory: "we aren't supporting new
Date(). we'll have limited support."

### 7. `this` is not a template identifier; handlers are the one door

- **A template expression never reaches the view instance.** `this` is not an
  identifier in any template expression: interpolation, attribute value,
  `{#if}`/`{#unless}`/`{#case}`/`{:when}` condition, `{#for}` header, `key=`,
  function argument, marker or prop argument, inline `{#if}`, skeleton — and
  `@event` handler arguments and handler ternary conditions too. Writing it is
  a positioned compile error at the `this` token: "`this` is not available in
  template expressions — return the value from data() (a getter or a computed
  field), or use a function for a display transform". `this?.`, `(this)` and
  `this[…]` get the same error; a field named `this` (`x.this`) is an ordinary
  member read. Codegen keeps the same message as a safety net behind the
  parser.
- **Every value a template shows comes through `data()` and the model.** A
  flag or a derived value is a `data()` field or an expression over one, and a
  display transform is a method or a function. A template that compiles in
  PuzzleKit therefore never depends on a view instance, which is what lets the
  same template be core Puzzle for Sites, which has none.
- **`@event={ handler(args) }` is the one door** into the view's JavaScript: a
  fire-time call that reaches the view through the handler's own name
  (`@click={ save(items.length - 1) }` calls the view's `save`). The value is
  a bare handler name, one call to a handler, a conditional whose branches are
  each one of those or `null`, or `null`. Its arguments use the same
  expression grammar, with `event` in scope, and are evaluated when the event
  fires. The handler ternary's condition is an ordinary expression.
- **A chain rooted at `event` is unrestricted.** Inside an `@event` handler
  the free name `event` is the DOM event, not template data, so the method
  table (rule 3) does not apply to a chain rooted at it: any member read and
  any DOM method call is legal (`event.target.value`,
  `event.target.closest('li')`, `event.preventDefault()`), and PuzzleKit
  lowers it as written, with no guards. `event` itself cannot be called. A
  bound `event` (a `{#for}` item, a snippet parameter, an arrow parameter)
  shadows the DOM event as in JavaScript, and its chain is ordinary data;
  PuzzleKit then names the DOM parameter `__ev`. A free `event` outside a
  handler is an error that says to rename a data field called `event`. This
  is a PuzzleKit-only extension by construction: Sites has no handlers.
- The handler is a dialect extension in the D172 sense, like `<Portal>`: Sites
  rejects `@event` with an error that says so.
- **No `{#let}` in PuzzleKit.** Cory: it "would allow people to put logic in
  the templates instead of in the JS and that's an anti-pattern for PuzzleKit
  but a necessity for Puzzle Sites." The docs state the mapping once:
  Sites `{#let x = …}` ⇔ PuzzleKit `data()` field.

### 8. The hosts

- **PuzzleKit codegen lowers the AST to JavaScript**
  (`compiler/internal/codegen/lower.go`, whose header carries the lowering
  table; [[COMPONENT-CODEGEN]]). Nothing reads an expression's source string:
  names resolve from the tree (arrow parameters shadow template bindings,
  which shadow the handler's `event`; every other name is `__d.<name>`), so
  an arrow parameter or a Unicode identifier can never be prefixed wrongly.
  Every member step, index step and method call is guarded (`?.`), handler
  arguments included; a library call becomes
  `(__f["name"] || __f.__missing("name"))(…)`; a method stays the same
  JavaScript method; `Math.*` stays `Math.*`; parentheses come from
  precedence. D170's row facts and D62's handler-caching verdicts are read
  off the same tree.
- **`puzzle check` emits TypeScript from the same tree** (the check target of
  the lowerer): no added guards (an authored `?.` stays), a library call
  through the shim's `__puzzle_fn`, whose standard signatures are
  `libraryFunctionSignatures` (kept equal to `codegen.LibraryFunctionNames` by
  a test) and whose index signature types app functions as `any`, and a method
  call with an arrow argument takes its receiver through
  `__puzzle_check_list(…)`, so an untyped receiver gives the arrow `any`
  parameters instead of a strict-mode implicit-any error. Because methods map
  one to one onto `lib.d.ts`, a wrong method on a typed value is a real
  TypeScript error at its `.pzl` column. The shim references the `lib` files
  the table needs whatever the app's `target`: `es2021.string`
  (`replaceAll`), `es2022.array`/`es2022.string` (`at`) and the rest from
  TypeScript 4.9, the oldest supported; `es2023.array` from TypeScript 5.0,
  which types `findLast`. `toSorted` and `toReversed` join that file only in
  TypeScript 5.2, so on 5.0 and 5.1 they report as missing, as they would in
  the app's own script.
- **Sites evaluates the AST in Go** with a tree-walking evaluator: a value
  model (string, float64, bool, nil, `[]any`, `map[string]any`, records), the
  method table, the function library and JavaScript number formatting. Its
  existing `engine/expr` allow-list is the base. Sites can lag PuzzleKit
  because it is not deployed.
- **Identifier classes follow the Go toolchain's Unicode tables.** `expr`
  decides `ID_Start`/`ID_Continue` with Go's `unicode` package, so the
  PuzzleKit compiler and Sites must build with the same Go minor to agree on
  edge characters; the identifier rows in `expressions-parse.json` pin it, so
  a toolchain skew fails a row instead of drifting.
- **Shared conformance** lives in puzzle-lang's `conformance` package
  (`packages/puzzle-lang/conformance`), which embeds each JSON file
  (`go:embed`), so Sites pins the rows at the language tag and both hosts run
  the same ones. `expressions-parse.json` pins the grammar: an expression and
  its S-expression tree with every node position, or its positioned error
  (421 cases, including handler, bindings and call-argument cases; Sites runs
  them through `conformance.ExpressionsParse` and `expr.Print`).
  `functions.json` pins the function library (`conformance.Functions`). A
  corpus proof parses every `.pzl` expression in the monorepo. The evaluation
  table, an expression and its inputs → the value, is still planned.

### 9. Template rules around the expression

Unchanged: markers and snippets, `{#raw}`, D168 whitespace, keys, islands, the
`{#for}` loop domain (D173 V12), D170 list blocks, D173 V6 value printing and
the markup-position rule. Changed by this card: every expression position is
one `expr.Parse` — there are no pipes, so no pipe-position, nested-pipe or
header-pipe rules; the count is JavaScript's `.length`;
`{#for t in todos.filter(t => !t.done)}` and `{#if items.length}` are legal;
`{#unless c}` is `!` over the parsed condition; and the allowed globals are
the namespace whitelist in rule 1.

### One answer per question

| Need | Expression |
|---|---|
| count of a list or string | `x.length` |
| math | `+ - * / %` and `Math.*`, then a function to present the result |
| fallback | `x ?? y` |
| transform a displayed value | a method or a function: `{ name.toUpperCase() }`, `{ currency(price) }` |
| shape a list | array methods: `{#for t in todos.filter(t => !t.done)}` |
| an app's own display logic | a registered function: `{ specialFormat(product.title) }` |
| a browser value (`window`, `localStorage`) | read it in `data()` and pass the value |
| reach the view instance | never: `this` is not a template identifier |
| run view code | an `@event` handler (PuzzleKit only) |

## Migration

Moving from 0.7 is one change of expression syntax: `{ x | f }` → `{ f(x) }`;
`{ x | f(a) }` → `{ f(x, a) }`; `{ x | a | b }` → `{ b(a(x)) }`; `.size` →
`.length`; `| upcase` → `.toUpperCase()`; `| trim` → `.trim()`;
`| join(', ')` → `.join(', ')`; `| replace(a, b)` → `.replaceAll(a, b)`;
`| abs` → `Math.abs(x)`; `| round(2)` → `round(x, 2)`; the removed list
formatters → methods (`.filter`, `.map`, `.toSorted`, `.at(0)`, `.at(-1)`).
No codemod ships. Cory: "No one is using our framework yet, only me." P4
migrated the repo's own corpus with a throwaway script that is not shipped
(136 chains in 92 files, 103 `.size` reads; seven `.size` reads stayed because
the receiver is an object with its own `size` field).

## Open

Two questions older than this card, still undecided:

- **`tel:` links in the `raw` allowlist.** The PuzzleKit sanitizer keeps a
  `tel:` URL on an `<a href>` (matching Sites' SanitizeRichText); whether it
  stays in the shared allowlist is not confirmed.
- **The `currency` delimiter.** `currency` groups thousands with a fixed `,`;
  whether it should follow the locale, as `number_with_delimiter` does, is not
  decided.

## Alternatives rejected

- **A Puzzle data language with Liquid-style pipes.** Template expressions as
  data plus operators: `.size` as the one built-in property and the count,
  `.length` and every call on a value a compile error, `??` as the fallback, a
  formatter only after a top-level `|` in a display position (never in a
  condition or `{#for}` header, never nested), a 27-name standard formatter
  set shared with Sites, and "compute it first" in a `data()` field or a Sites
  `{#let}`. Rejected for the reasons Vue 3 gave when it removed filters, which
  hold here unchanged: the pipe is custom syntax; it breaks the assumption
  that what sits in the braces is just JavaScript; that costs every author a
  learning step; and it costs the implementation. Here that cost is the
  pipe-position rules, the nested-pipe and header-pipe errors and the
  formatter-name grammar, carried by the parser, the eslint and prettier ports
  and three editor grammars. The 0.8.0 review found the drift the approach
  produces:
  - validation was a JavaScript deny-list in PuzzleKit codegen and a separate
    allow-list parser in Sites; they disagreed on about a dozen inputs
    (`a ** 2`, spread, `void`/`delete`, `(a, b)`, `+a`, `0xFF`, `1_000`, `10n`,
    comments) and on error wording and positions, and the only shared fixture
    sat outside the Go module;
  - the token-scanning resolver mis-prefixed Unicode identifiers
    (`{ größe }` → `__d.größ__d.e`) and arrow parameters;
  - the cards themselves kept writing JavaScript the data language rejected
    (`i === items.length - 1`, `t({ count: cart.items.length })`), and the
    corpus held ~160 `.length` reads against zero uses of the duplicate
    formatters.

  A closed grammar parsed once, with one conformance table both hosts run,
  removes that class of drift, and the syntax is the one authors already type.
- **Ship the pipe data language in 0.8.0 and change the syntax again in 0.9.**
  Rejected: two template breaks instead of one. The 0.8.0 tag waits for P1–P5.
- **Full JavaScript, run by a JavaScript engine in Sites.** Rejected: "we
  aren't going to run JS in Sites, it needs to be in Go."
- **Vue's model, where an expression is whatever JavaScript the compiler
  accepts.** Rejected: a Go host cannot evaluate open-ended JavaScript. A closed
  grammar plus a method table (Angular's model) is what makes one language
  evaluable in both hosts.
- **Each host accepting its own subset.** Rejected: that is the drift above.
  There is one table, and Sites only switches entries off (rule 5).
- **Keep `upcase`, `trim`, `join` and the other covered names as library
  functions** (P3 carried them deprecated, with a warning naming each
  replacement, until P4 deleted them). Rejected: two ways to say the same
  thing, the duplication the pipe language was rejected for.
- **`===` only.** Rejected: `==` keeps its JavaScript meaning (D173 V2), and Go
  implements the coercion on primitives.
- **A method call on a missing value as an error.** Rejected: it is guarded
  and prints nothing, exactly like a member read (deviation 1).
- **The library name winning a bare call inside `@event`**, or the library as
  a fallback when the view has no handler of that name. Rejected: a handler
  value's own call always names the view's handler; a collision draws a
  warning instead (rule 4).
- **Browser globals as template reads** (`window.scrollY`,
  `localStorage.theme`). Rejected: none is template data, Sites has none, and
  as a bare name each silently read a `data()` field of the same name; the
  steer points to `data()`.
- **Rename the registration API to `app.function()` or a `functions` config
  key.** Rejected for now: the `formatters` config key keeps its name, and so
  do the compiler-facing `formatters` runtime modules.
- **A shipped `puzzle migrate` codemod.** Rejected: "No one is using our
  framework yet, only me."
- **`new Date()` and date methods.** Rejected (rule 6): "we aren't supporting
  new Date(). we'll have limited support."
- **Mutating array methods** (`push`, `sort`, `reverse`, `splice`). Rejected:
  an expression must not change the data it reads, and `toSorted` and
  `toReversed` cover display.
- **`this.` as a door into the view** — `{ this.ago(createdAt) }`,
  `disabled={ !this.canAdd }`, with the whole chain JavaScript and calls
  allowed through it. Rejected: it bypasses `data()`, the one path data takes
  into a view, and Sites has no view instance, so it could never be core. In
  review it produced an arrow-parameter miscompile
  (`this.items.filter(i => i.done)` compiled to invalid JavaScript), a silent
  `.size` trap, and a host-only escape hatch. Its only uses in the shipped
  corpus were three `disabled={ !this.getter }` flags, each expressible as a
  `data()` field. Cory: "lets remove this from templates, we don't need it,
  the templates are set up to have all data pass through data() and go into
  the model and then get rendered in the view template. I feel like adding
  "this" breaks that and lets them call the object directly and that's an
  anti-pattern in PuzzleKit and can't be used at all in Puzzle-lang in
  Sites."
- **Keep `this` as a read-only root.** Rejected: still a second path into the
  view; `data()` is the path.
- **Add `{#let}` to PuzzleKit.** Rejected (rule 7).

## Consequences

- **Breaking for templates.** Every pipe becomes a call, every `.size` a
  `.length`, and the removed formatters become methods and `Math.*`. The
  CHANGELOG's 0.8.0 entry opens with an "Upgrading from 0.7" checklist.
- **The parser owns the expression language.** Validation lives in
  puzzle-lang, not in PuzzleKit codegen: `datalang.go`, the resolver's token
  scan, `jsGlobals`, `sizeSteps` and the `__z` size helper are gone, and the
  template parser's chain code (`parseChain`, `FormatterCall`,
  `nestedPipeIndex`, the header-pipe errors) with them.
- **Sites** evaluates the shared AST in Go, building on `engine/expr`, and
  pins the grammar, the method table, the function library and the
  conformance rows at the puzzle-lang tag. Sites is not deployed, so none of
  this is a Sites upgrade.
- **The eslint and prettier ports** still carry pipe handling in their
  vendored lexers, and the three editor grammars still color a `| name` tail,
  as does the pieces demo's highlighter; P5 sweeps them.
- **Carried over unchanged:** D173 V2's loose `==`, V4's guarded member reads,
  V6's value printing, the markup-position rule for `raw` and
  `newline_to_br`, and rule 7.

## Build list

Each phase is a PR into `release/0.8.0`, except P6, which lands in the Sites
repo. The 0.8.0 tag waits for P1–P5.

- **Rule 7 — Built** (PR #163, merged as 9ca0547e): `this` is rejected in
  every template expression, handler arguments and the handler ternary
  condition included, with the message on the `this` token itself. The three
  corpus uses moved into `data()`.
1. **P1 — Built** (PR #164). puzzle-lang: the `expr` package (grammar, AST,
   Pratt parser, method table, positioned errors, `Walk`/`Print`); the
   template parser filling a parsed sibling for every expression field and
   passing its `{#for}`/`<Snippet>` bindings; the `conformance` package with
   `expressions-parse.json` and the function rows moved in from
   `packages/puzzle/tests/conformance`.
2. **P2 — Built** (PR #167). Codegen lowers from the AST (`lower.go`),
   replacing the resolver's token scan, `datalang.go`, `jsGlobals` and the
   number/regex scanners; D170 row facts and D62 verdicts from the tree; the
   `puzzle check` emitter from the same lowering, with the library signatures
   and the TypeScript `lib` references; the handler/library collision
   warning; goldens.
3. **P3 — Built** (PR #168, test-timer fix #169). Runtime: the formatter
   registry becomes the function library (`STANDARD_FORMATTERS` of 19,
   PuzzleKit-only `link`/`timeago`), `warnHandlerShadows`, the new
   `time`/`datetime` defaults, the `t` key rule, the removed-name hints,
   `LibraryFunctions` in `types/`, and `functions.json` (renamed from
   `formatters.json`). The module keeps its `formatters.js` name.
4. **P4 — PR #171, in review.** The corpus migrated by a throwaway script;
   the template parser drops chains for one `expr.Parse` per position, with
   the `|` steer and the browser-globals steer; codegen drops pipe lowering,
   the `.size` helper and every `P4: remove` block, and adds the literal
   preset/zone check (`codegen/presets.go`); the runtime deletes the nine
   covered names, `formatters/deprecated.js`, `size.js` and `sizeOf`; the
   CHANGELOG, skill, README and example docs; D173–D176 and the component
   cards truthed.
5. **P5 — Planned.** The eslint and prettier ports drop pipe handling; the
   three editor grammars (separate repos) get a sweep; the pieces demo's
   highlighter. P1b, the HTML void set without a slash (`<input>`, with
   `</input>` the error), is its own small parser PR, also planned.
6. **P6 — Planned.** Sites, after the tag: the Go evaluator and the function
   library, and the evaluation conformance table.
