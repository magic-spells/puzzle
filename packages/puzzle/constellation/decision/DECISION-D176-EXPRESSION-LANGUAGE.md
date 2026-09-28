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
---

# D176 — The expression language: JavaScript-shaped, parsed once, evaluated by both hosts

**Status: decided by Cory on 2026-09-28, sub-decisions included; building for
0.8.0.** P1, the expression parser in puzzle-lang, is in flight; the phases are
the build list, and the 0.8.0 tag waits for P1–P5. Until P2–P4 land,
`release/0.8.0` compiles the pipe-and-`.size` data language described under
*Alternatives rejected*, plus the `this` rejection of rule 7 (PR #163, merge
9ca0547e), which carries over unchanged. D173's pipe and `.size` rules, D174's
27-name formatter set and D175's `| t` spelling are superseded by this card and
are rewritten in place in P4. Two older questions remain under *Open*.

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

A new package in puzzle-lang, `expr` (imported by `parser`), parses every
template expression into an AST both hosts consume. Every node carries a
position, so an error reports the same line:col in both hosts. Anything outside
this grammar is a positioned compile error in both hosts.

- **Literals:** `'str'` and `"str"` with JavaScript escapes; template literals
  `` `a ${expr} b` ``; decimal numbers (`1e3`, `0.5`; no hex, octal, bigint or
  numeric separators); `true`, `false`, `null`, `undefined`; arrays `[a, b]`;
  objects `{ k: v, 'k': v, k }` (no spread, no computed keys, no methods).
- **Identifiers:** JavaScript `ID_Start`/`ID_Continue` (Unicode letters,
  digits and marks, `_`, `$`). Reserved words are rejected, `this` is rejected
  (rule 7), and `event` is a handler-only name.
- **Access:** `a.b`, `a?.b`, `a[expr]`, `a?.[expr]`.
- **Calls,** three kinds:
  - `name(args)` calls a function from the library (rule 4);
  - `a.m(args)` and `a?.m(args)` call a method the method table lists for the
    receiver's runtime type (rule 3); any other method is a compile error;
  - the global namespaces: `Math.abs`, `ceil`, `floor`, `round`, `trunc`,
    `max`, `min`, `sign`, `pow`, `sqrt`; `Number(x)`, `String(x)`,
    `Boolean(x)`; `Array.isArray(x)`; `Object.keys`, `values`, `entries(x)`;
    `parseInt`, `parseFloat`, `isNaN`, `isFinite`. There is no `Date`, `JSON`,
    `window`, `document`, `console`, `Intl`, `Map`, `Set` or `fetch`; dates and
    JSON are the `date()` and `json()` functions.
- **Arrow functions** only as call arguments, with an expression body and no
  destructuring: `x => expr`, `(x, i) => expr`.
- **Operators,** with JavaScript precedence: unary `!` `-` `+`; `*` `/` `%`;
  `+` `-`; `<` `<=` `>` `>=`; `==` `!=` `===` `!==`; `&&`; `||`; `??`; `?:`;
  parentheses. Excluded: the bitwise operators (so there is no `|` at all),
  `**`, `in`, `instanceof`, `typeof`, `void`, `delete`, `new`, the comma
  operator, assignment, `++`/`--`, regex literals, statements, `function`,
  classes, `await`/`yield` and spread.

### 2. JavaScript semantics, with two deviations both hosts implement

Everything in the grammar means what it means in JavaScript: truthiness, `+`
concatenating when either side is a string, `==` and `!=` as JavaScript's loose
equality on primitives (D173 V2; Go coerces primitives the way JavaScript
does), number-to-string conversion as JavaScript does it (`0.1 + 0.2`, `-0` →
`"0"`, `1e21`), `NaN` and `Infinity`, `?.` short-circuiting, and `??`. Two
deviations hold in both hosts:

1. **A member read never throws** (D173 V4): `a.b.c` on a missing path is
   `undefined` (nil in Go), which prints nothing. A method call on a missing
   value is guarded the same way: `x.trim()` with `x` missing prints nothing
   and draws a development warning.
2. **Printing is display, not expression semantics** (D173 V6): `null`,
   `undefined`, `NaN`, ±Infinity and dates print nothing, a list joins, and any
   other object prints nothing and draws a development warning.

### 3. The method table is the boundary

A method is callable only when the table lists it for the receiver's runtime
type. Each entry is a JavaScript method with a Go reimplementation that behaves
exactly like it, pinned by a conformance row. No entry mutates its receiver:
there is no `push`, `pop`, `splice`, `sort` or `reverse`, and `toSorted` and
`toReversed` cover display. The v1 table:

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
  and its `size` is not special.

### 4. Functions instead of pipes

There is no pipe. A formatter is a function, called like one:
`{ currency(price) }`, `{ truncate(post.body, 120) }`; a chain nests:
`{ b(a(x)) }`. The library holds only the names that no JavaScript method or
`Math` global covers, or that need the framework: `link(url)`, `t(key, vars)`,
`currency(v, symbol, places)`, `percentage(v, d)`,
`number_with_delimiter(v, sep)`, `compact_number(v)`,
`pluralize(n, one, many)`, `date(v, preset)`, `time(v, preset)`,
`datetime(v, preset)`, `truncate(s, n, ellipsis)`, `capitalize(s)`,
`strip_html(s)`, `strip_newlines(s)`, `escape(s)`, `raw(html)`,
`newline_to_br(s)`, `json(v)` and `timeago(v)`. Sites ships the same set in Go.
`upcase`, `downcase`, `trim`, `strip`, `replace`, `join`, `abs`, `ceil`,
`floor` and `round` are not functions: `.toUpperCase()`, `.toLowerCase()`,
`.trim()`, `.replace()`, `.join()` and `Math.*` already say them.

- **Date presets.** `time(v)` defaults to the short preset (`3:04 PM`), and
  `datetime(v)` defaults to the medium date with the short time
  (`Sep 24, 2026, 3:04 PM`).
- **An app registers its own functions** through `app.formatter()`, which
  keeps its name, and calls them bare, as Cory put it:
  `{ specialFormat(product.title) }`.
- **Resolution.** A bare call `name(…)` resolves to the library, so a data
  field is never callable, and a bare read `name` resolves to `data()`. A
  library name that shadows a data field draws a development warning.
- **Inside an `@event` value** a bare call resolves to the view's handler
  first, and to the library only when the view has no handler of that name.
  Cory: "we should throw a warning if there are two with the same name", so a
  handler name that collides with a library function name draws a development
  warning.
- **`raw` and `newline_to_br` keep the markup-position rule** (D174 group e):
  each may only be the whole of a text interpolation, the outermost call.

### 5. One shared table; Sites switches entries off

The grammar, the method table, the global namespaces and the function library
are one shared table in puzzle-lang, and that table is the superset. PuzzleKit
accepts all of it, and Sites may switch entries off. Cory: "a lot of these
things might work in Puzzle Kit but then not be supported in Sites and that's
fine." Nothing outside the table compiles in either host, and an entry Sites
has switched off is a positioned error there that says so. That is a
restriction in D172's sense, never a redefinition: an entry means the same
thing wherever it is on.

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
  field), or use a formatter for a display transform". `this?.`, `(this)` and
  `this[…]` get the same error; a field named `this` (`x.this`) is an ordinary
  member read.
- **Every value a template shows comes through `data()` and the model.** A
  flag or a derived value is a `data()` field or an expression over one, and a
  display transform is a method or a function. A template that compiles in
  PuzzleKit therefore never depends on a view instance, which is what lets the
  same template be core Puzzle for Sites, which has none.
- **`@event={ handler(args) }` is the one door** into the view's JavaScript: a
  fire-time call that reaches the view through the handler's own name
  (`@click={ save(items.length - 1) }` calls the view's `save`). Its arguments
  use the same expression grammar, with `event` in scope, and are evaluated
  when the event fires. The handler ternary's condition is an ordinary
  expression.
- The handler is a dialect extension in the D172 sense, like `<Portal>`: Sites
  rejects `@event` with an error that says so.
- **No `{#let}` in PuzzleKit.** Cory: it "would allow people to put logic in
  the templates instead of in the JS and that's an anti-pattern for PuzzleKit
  but a necessity for Puzzle Sites." The docs state the mapping once:
  Sites `{#let x = …}` ⇔ PuzzleKit `data()` field.

### 8. The hosts

- **PuzzleKit codegen lowers the AST to JavaScript.** The `__d.` prefix comes
  from the AST, so an arrow parameter or a Unicode identifier can never be
  prefixed wrongly; member reads and method calls are guarded per deviation 1;
  a library call becomes `__f.name(…)`; a method stays the same JavaScript
  method; `Math.*` stays `Math.*`. D170's row facts come from the AST.
  `puzzle check` emits TypeScript from the AST, and because methods map one to
  one onto `lib.d.ts`, a wrong method is a real TypeScript error.
- **Sites evaluates the AST in Go** with a tree-walking evaluator: a value model
  (string, float64, bool, nil, `[]any`, `map[string]any`, records), the method
  table, the function library and JavaScript number formatting. Its existing
  `engine/expr` allow-list is the base. Sites can lag PuzzleKit because it is
  not deployed.
- **Shared conformance:** `tests/conformance/expressions.json` (an expression
  and its inputs → the value) and `functions.json` move into puzzle-lang
  (`go:embed`), so Sites pins them at the language tag and both hosts run the
  same rows.

### 9. Template rules around the expression

Unchanged: markers and snippets, `{#raw}`, D168 whitespace, keys, islands, the
`{#for}` loop domain (D173 V12), D170 list blocks, D173 V6 value printing and
the markup-position rule. Changed by this card: there are no pipes, so the
pipe-position rules, the nested-pipe error and the header-pipe errors go with
them; the count is JavaScript's `.length`; `{#for t in todos.filter(t => !t.done)}`
and `{#if items.length}` are legal; and the `jsGlobals` list gives way to the
namespace whitelist in rule 1.

### One answer per question

| Need | Expression |
|---|---|
| count of a list or string | `x.length` |
| math | `+ - * / %` and `Math.*`, then a function to present the result |
| fallback | `x ?? y` |
| transform a displayed value | a method or a function: `{ name.toUpperCase() }`, `{ currency(price) }` |
| shape a list | array methods: `{#for t in todos.filter(t => !t.done)}` |
| an app's own display logic | a registered function: `{ specialFormat(product.title) }` |
| reach the view instance | never: `this` is not a template identifier |
| run view code | an `@event` handler (PuzzleKit only) |

## Migration

Moving from 0.7 is one change of expression syntax: `{ x | f }` → `{ f(x) }`;
`{ x | f(a) }` → `{ f(x, a) }`; `{ x | a | b }` → `{ b(a(x)) }`; `.size` →
`.length`; `| upcase` → `.toUpperCase()`; `| trim` → `.trim()`;
`| join(', ')` → `.join(', ')`; `| round(2)` → `Math.round(…)` or
`.toFixed(2)`; the removed list formatters → methods (`.filter`, `.map`,
`.toSorted`, `.at(0)`, `.at(-1)`). No codemod ships. Cory: "No one is using our
framework yet, only me." P4 migrates the repo's own corpus with a throwaway
script that is not shipped.

## Open

Two questions older than this rewrite, still undecided:

- **`tel:` links in the `raw` allowlist.** The PuzzleKit sanitizer keeps a
  `tel:` URL on an `<a href>` (matching Sites' SanitizeRichText); whether it
  stays in the shared allowlist is not confirmed.
- **The `currency` delimiter.** `currency` groups thousands with a fixed `,`
  today; whether it should follow the locale, as `number_with_delimiter` does,
  is not decided.

## Alternatives rejected

- **A Puzzle data language with Liquid-style pipes.** Template expressions as
  data plus operators: `.size` as the one built-in property and the count,
  `.length` and every call on a value a compile error, `??` as the fallback, a
  formatter only after a top-level `|` in a display position (never in a
  condition or `{#for}` header, never nested), a 27-name standard formatter
  set shared with Sites (D174), and "compute it first" in a `data()` field or a
  Sites `{#let}`. Rejected for the reasons Vue 3 gave when it removed filters,
  which hold here unchanged: the pipe is custom syntax; it breaks the
  assumption that what sits in the braces is just JavaScript; that costs every
  author a learning step; and it costs the implementation. Here that cost is
  the pipe-position rules, the nested-pipe and header-pipe errors and the
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
- **Keep `upcase`, `trim`, `join`, `round` and the other covered names as
  library functions.** Rejected: two ways to say the same thing, the
  duplication the pipe language was rejected for.
- **`===` only.** Rejected: `==` keeps its JavaScript meaning (D173 V2), and Go
  implements the coercion on primitives.
- **A method call on a missing value as an error.** Rejected: it is guarded
  and prints nothing, exactly like a member read (deviation 1).
- **The library name winning a bare call inside `@event`.** Rejected: a
  handler value calls the view's handler; a collision draws a warning instead
  (rule 4).
- **Rename the registration API to `app.function()`.** Rejected for now:
  `app.formatter()` keeps its name.
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
  `.size` trap (`{#if this.items.size > 0}` was always false, because the chain
  was JavaScript and an array has no `size`), and a host-only escape hatch. Its
  only uses in the shipped corpus were three `disabled={ !this.getter }`
  flags, each expressible as a `data()` field. Cory: "lets remove this from
  templates, we don't need it, the templates are set up to have all data pass
  through data() and go into the model and then get rendered in the view
  template. I feel like adding "this" breaks that and lets them call the
  object directly and that's an anti-pattern in PuzzleKit and can't be used at
  all in Puzzle-lang in Sites."
- **Keep `this` as a read-only root.** Rejected: still a second path into the
  view; `data()` is the path.
- **Add `{#let}` to PuzzleKit.** Rejected (rule 7).

## Consequences

- **Breaking for templates.** Every pipe becomes a call, every `.size` a
  `.length`, and the removed formatters become methods and `Math.*`. The
  CHANGELOG's "Upgrading from 0.7" checklist is rewritten in P4.
- **The parser owns the expression language.** Validation moves out of
  PuzzleKit codegen into puzzle-lang: `datalang.go`, the resolver's token scan,
  `sizeSteps`, `nestedPipeIndex` and the header-pipe errors retire in P2, and
  the `__z` size helper goes with `.size`.
- **Sites** evaluates the shared AST in Go, building on `engine/expr`, and
  pins the grammar, the method table, the function library and the
  conformance rows at the puzzle-lang tag. Sites is not deployed, so none of
  this is a Sites upgrade.
- **The eslint and prettier ports** drop pipe handling, and the three editor
  grammars get a sweep (P5).
- **Other cards:** D173 (V1 and the pipe forms, V7's `.size`), D174 (the
  27-name set becomes the function library) and D175 (`| t` becomes `t()`) are
  rewritten in place in P4, as are DOC-LANGUAGE-CORE and the SPEC cards. Until
  then they describe what `release/0.8.0` compiles today.
- **Carried over unchanged:** D173 V2's loose `==`, V4's guarded member reads,
  V6's value printing, the markup-position rule for `raw` and
  `newline_to_br`, and rule 7.

## Build list

Each phase is a PR into `release/0.8.0`, except P6, which lands in the Sites
repo. The 0.8.0 tag waits for P1–P5.

- **Built** (PR #163, merged as 9ca0547e): rule 7. `this` is rejected in every
  template expression, handler arguments and the handler ternary condition
  included, with the rule 7 message placed on the `this` token itself (the
  whole file comes from `parser.Sections.Source`, so a `this` in a
  `<puzzle-view>` root attribute is placed too). The three corpus uses
  (typed-todos `Home.pzl`, chat `Composer.pzl`, blog `PostDetail.pzl`) moved
  into `data()`. `this` stays in the resolver's keyword table as defense in
  depth.
1. **P1 — Building.** puzzle-lang: the expression grammar, AST, parser and
   positioned errors (the `expr` package), and the `expressions.json`
   fixtures. Roughly 1.5k lines of Go plus tests.
2. **P2 — Planned.** Codegen lowers from the AST, replacing the resolver's
   token scan, `datalang.go` and `sizeSteps`; D170 row facts come from the
   AST; the `puzzle check` emitter; goldens. The largest phase: the resolver is
   about 1.4k lines today.
3. **P3 — Planned.** Runtime: the function library behind `app.formatter()`,
   the `@event` collision warning and the new `time`/`datetime` defaults; the
   pipe plumbing goes; `formatters.js` becomes `functions.js`; the conformance
   rows.
4. **P4 — Planned.** Corpus and docs: a throwaway migration script (not
   shipped) over the examples, scaffolds, pieces and the agent skill; the
   CHANGELOG rewritten; D173, D174 and D175 rewritten in place (one card each),
   with DOC-LANGUAGE-CORE and the SPEC cards; the README size banner
   re-measured.
5. **P5 — Planned.** The eslint and prettier ports drop pipe handling; the
   three editor grammars (separate repos) get a sweep.
6. **P6 — Planned.** Sites, after the tag: the Go evaluator and the function
   library.
