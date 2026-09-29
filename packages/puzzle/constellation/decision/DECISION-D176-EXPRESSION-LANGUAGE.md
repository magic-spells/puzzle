---
name: >-
  D176 — The expression language: JavaScript-shaped, one closed grammar parsed in puzzle-lang, a
  method table, functions instead of pipes
status: built
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

# D176 — The expression language

Template expressions are JavaScript-shaped, defined by **one closed grammar
and a method table**, parsed once in `packages/puzzle-lang/expr`, and
implemented by each host: PuzzleKit lowers the AST to JavaScript; Sites
(pending, its own repo) evaluates it in Go. Semantics are
[[DECISION-D173-CORE-SEMANTICS]], the function library
[[DECISION-D174-STANDARD-FORMATTERS]], translations
[[DECISION-D175-TRANSLATIONS]].

## Context

[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]: one language, two hosts, and
Sites will not embed a JS engine (Cory: "we aren't going to run JS in Sites,
it needs to be in Go"). Cory chose JavaScript's syntax over a Puzzle-specific
one "for the same reason that Vue moved away from the filter pipe syntax. The
js has no learning curve … more devs will expect to be able to drop js in the
brackets and just have it work." The model is **Angular's** (closed grammar +
method table, evaluable in Go), not Vue's (whatever JS the compiler accepts).

## 1. The grammar (`packages/puzzle-lang/expr`)

Lexer, Pratt parser, AST, method table, printer. The template parser calls
`expr.Parse(src, base, Options{Handler, Bindings})` once per expression
position and stores the tree. Every node carries a file position (same
line:col in both hosts); parsing is linear. Anything outside the grammar is a
positioned compile error naming the construct and the alternative.

- **Literals:** `'s'`/`"s"` with strict-mode escapes (raw line break, legacy
  octal, lone surrogate are errors); template literals `` `a ${x}` ``;
  decimal numbers only (hex/octal/binary, BigInt, `1_000`, leading zero, a
  name right after a number are errors); `true false null undefined NaN
  Infinity` (literals, not names); arrays; objects `{ k: v, 'k': v, k }` (no
  spread, computed keys, methods, numeric keys).
- **Identifiers:** JS `ID_Start`/`ID_Continue`. Reserved words rejected except
  `eval`/`arguments` (plain data names). `this` is rejected (§7). `__proto__`,
  `constructor`, `prototype` rejected as member names and object keys (a Go
  host's maps have no prototype).
- **Access:** `a.b`, `a?.b`, `a[x]`, `a?.[x]`.
- **Calls:**
  - `name(args)` — a library function (§4). Calling a template binding
    (`{#for}` item/counter, `<Snippet>` parameter, arrow parameter) is an
    error, so `t('k')` inside `{#for t in …}` never reaches the library.
  - `a.m(args)` / `a?.m(args)` — a method-table method (§3); others are an
    error naming the alternative (`sort` → `toSorted()`, `push` →
    `concat()`, `substr` → `slice()`, `getFullYear` → `date(v, preset)`).
    `.length()` is an error. `a[name]()`, `f(x)(y)` and `f?.(x)` are errors.
  - Globals: `Math.abs ceil floor round trunc max min sign pow sqrt`;
    `Number String Boolean`; `Array.isArray`; `Object.keys values entries`;
    `parseInt parseFloat isNaN isFinite`; `encodeURIComponent
    decodeURIComponent encodeURI decodeURI`. Globals are only called, except
    the constants `Math.PI`/`Math.E`; `Math` alone is not a value
    (`filter(Boolean)` → write `x => Boolean(x)`). No `Date`, `JSON`, `Intl`,
    `Map`, `Set`, `fetch`.
- **Browser global objects are not data.** Reading `window`, `document` or
  `globalThis` as a data root (bare, chain root, or `{ window }` shorthand) is
  an error: "`window` is the browser window, which template expressions
  cannot reach — read the value you need in data() and return it". Other
  browser names (`navigator`, `location`, `console`, `localStorage`) are
  ordinary `data()` field reads; calling their methods fails at the method
  table. Bindings/arrow params with those names, callees and handler names
  are exempt.
- **Arrows** only as call arguments, expression body, plain params:
  `x => e`, `(x, i) => e`, `x => ({ … })`.
- **Operators** (JS precedence): unary `! - +`; `* / %`; `+ -`;
  `< <= > >=`; `== != === !==`; `&&`; `||`; `??`; `?:`; parens. `??` mixed
  with `&&`/`||` unparenthesized is an error, as in JS. **Excluded:** bitwise
  ops, `**` (→ `Math.pow`), `in`, `instanceof`, `typeof`, `void`, `delete`,
  `new`, comma, assignment, `++`/`--`, regex literals, comments, statements,
  `function`, classes, `await`/`yield`, tagged templates, spread.
- **No pipe.** Any `|` → "`| name` pipes were removed — write `name(value)`;
  bitwise OR is not available" (naming the replacement when `name` is a
  removed formatter — `RemovedFormatters` in `expr/errors.go`, D174).

## 2. JavaScript semantics, two shared deviations

Everything means what it means in JS: truthiness, `+` concatenation, loose
`==` on primitives (D173 V2), JS number-to-string, `NaN`/`Infinity`, `?.`
short-circuit, `??`. Deviations, both hosts:

1. **A missing value never throws** (D173 V4): member reads and method calls
   on a missing value yield `undefined` and print nothing — with **no dev
   warning for the method-call case, by design** (it would need a production
   helper or a double evaluation). `Object.keys/values/entries` of a missing
   value are `[]`.
2. **Printing is display** (D173 V6).

## 3. The method table is the boundary (`expr/methods.go`)

A method is callable only if the table lists it. When the syntax fixes the
receiver type (a literal, template literal, array/object literal,
`Math.PI`, `Number(x)`, `Object.keys(x)`…), the method is checked against
that type at parse time (`'s'.filter(f)` is an error). On a data path the
name need only be in the table; `puzzle check` then types it as the JS method
and Sites checks the runtime type. Each entry is a JS method with an exact Go
reimplementation, pinned by conformance. **Nothing mutates its receiver.**

- **String:** `length at charAt includes startsWith endsWith indexOf
  lastIndexOf slice substring split(sep, limit) replace(str, str)
  replaceAll trim trimStart trimEnd toUpperCase toLowerCase padStart padEnd
  repeat concat`. `.length` is UTF-16 units in both hosts.
- **Array:** `length at includes indexOf lastIndexOf slice concat join
  flat(1) find findIndex findLast filter map some every reduce(fn, init)
  toSorted(cmp?) toReversed`. Callbacks get `(item, index)` — no third
  argument.
- **Number:** `toFixed(d)`, `toString()` (no radix).
- **Boolean/null/undefined:** none. **Records/objects:** property access only
  (iterate with `Object.*`). **Map/Set:** not in v1; `.size` is an ordinary
  member read.
- Not in v1: `localeCompare`, `normalize`, `entries`, `keys`, `toPrecision`.
- **Exception:** a chain rooted at the DOM `event` in a handler (§7).

## 4. Functions instead of pipes

A display transform is a call: `{ currency(price) }`, `{ b(a(x)) }`. The
library holds only what no method, operator or `Math` global covers (D174).

- **Resolution.** A bare call resolves to the library; a bare read resolves
  to `data()`. They never resolve to each other (so a data field sharing a
  function's name is not ambiguous and draws no warning, by design). An
  unregistered name is the D43 guard: value passes through with a dev error
  (did-you-mean or the removed name's replacement).
- **Apps register functions** through the `formatters` config map and call
  them bare: `{ specialFormat(product.title) }`.
- **Inside an `@event` value** the handler's own call (the whole value, or a
  branch of its top-level conditional) names the view's handler; calls in
  its arguments and condition are library calls. A handler named like a
  library function warns (compile time for standard/PuzzleKit-only names;
  at mount in dev for any library name) — the one name-collision warning,
  because only there can one spelling mean two things.
- **`raw`/`newline_to_br`** keep D174's markup placement rule.
- **A function that throws fails the render** — no `try` around library,
  app or method calls; the view fails and `errorView` takes over
  ([[DECISION-D145-ERROR-BOUNDARIES]]). Only an `@event` handler throw stays
  uncaught.
- Date presets, unknown-preset warnings and zone handling: D174.

## 5. One shared table; Sites switches entries off

Grammar, method table, globals and standard library are one table in
puzzle-lang, the superset. PuzzleKit accepts all of it; Sites may switch
entries off (a positioned error saying so) — a D172 restriction, never a
redefinition. Functions are the one open end (app or platform functions join
by name).

## 6. Dates: limited

No `new`, no `Date` global, no date methods. Dates come from `data()` or the
model and display through `date()`, `time()`, `datetime()`, `timeago()`. A
date takes only `< <= > >=` and binary `-` (milliseconds) in both hosts.

## 7. No `this`; handlers are the one door

- **`this` is not an identifier in any template expression** (handler
  arguments and conditions included): a positioned error on the token —
  "`this` is not available in template expressions — return the value from
  data() (a getter or a computed field), or use a function for a display
  transform". `x.this` is an ordinary member read. Every displayed value comes
  through `data()` and the model, so a PuzzleKit template never depends on a
  view instance — which is what makes it core Puzzle for Sites.
- **`@event={ handler(args) }`** is the only door into view JS. The value is
  a bare handler name, one handler call, a conditional whose branches are
  each one of those or `null`, or `null`. Arguments use the same grammar,
  with `event` in scope, evaluated at fire time.
- **A chain rooted at the free `event` in a handler is unrestricted** (any
  member, any DOM method: `event.target.closest('li')`,
  `event.preventDefault()`), lowered as written with no guards. `event`
  itself cannot be called. A bound `event` (loop item, snippet or arrow
  param) shadows the DOM event and is ordinary data; PuzzleKit then names the
  DOM parameter `__ev`.
- **Outside a handler `event` is an ordinary data name** (`__d.event`), so
  `<EventCard event={ item }>` works and two-way binds (D147). A template
  that both reads `event` as data (text, attribute, block header, a handler's
  conditional test) and uses the free `event` inside a handler is a
  positioned compile error at the handler use ("`event` here is the DOM
  event, but this template also reads `event` as data at 2:9 — rename the
  field or prop"); `puzzle check` reports it too.
- Handlers are a PuzzleKit dialect extension; Sites rejects `@event`.
- **No `{#let}` in PuzzleKit** (logic belongs in `data()`); Sites'
  `{#let x = …}` ⇔ a PuzzleKit `data()` field.

## 8. The hosts

- **PuzzleKit codegen** (`compiler/internal/codegen/lower.go`; its header
  carries the lowering table; [[COMPONENT-CODEGEN]]) lowers from the tree,
  never the source string: arrow params shadow template bindings, which
  shadow the handler's `event`; every other name is `__d.<name>`. Every
  member step, index step and method call gets `?.` (handler args too);
  `Object.*` take `<arg> ?? {}`; a library call is
  `(__f["name"] || __f.__missing("name"))(…)`; methods and `Math.*` stay as
  written. D170 row facts and D62 handler-caching verdicts come off the same
  tree.
- **`puzzle check`** emits TypeScript from the same tree: no added guards or
  `?? {}` (authored `?.` stays); a standard call as `__puzzle_fn.name(…)`
  typed by `libraryFunctionSignatures`; any other bare call as
  `__puzzle_app_fn("name")(…)` (a call, not an index signature, so it passes
  `noUncheckedIndexedAccess`); a method call with an arrow argument takes its
  receiver through `__puzzle_check_list(…)` so untyped receivers give `any`
  params. Methods map 1:1 onto `lib.d.ts`, so a wrong method is a real TS
  error at its `.pzl` column. The shim references the `lib` files the table
  needs regardless of the app's `target` (`es2021.string`,
  `es2022.array/string` from TS 4.9, the oldest supported; `es2023.array` from
  TS 5.0); `toSorted`/`toReversed` type only from TS 5.2.
- **Sites** (pending): a tree-walking Go evaluator — value model (string,
  float64, bool, nil, `[]any`, `map[string]any`, records), the method table,
  the library, JS number formatting — built on its `engine/expr` allow-list.
- **Identifier classes** come from `jsident.IsIDStart`/`IsIDContinue`
  (`packages/puzzle-lang/jsident`, Go's `unicode` tables), used by `expr`'s
  lexer, template tag names (D167) and PuzzleKit's `<script>` scan
  (`extractClassName`, `classNameFromFilename` — `Übersicht.pzl` is class
  `Übersicht` — import bindings, the `__d.` collision scan). `puzzle check`
  reads the class name back from codegen's render tail. A class name the scan
  cannot read to its end (a `\u` escape, or a character newer than Go's
  Unicode tables, e.g. U+30FB) is a positioned error, never a cut name.
  **PuzzleKit and Sites must build with the same Go minor**; identifier rows
  in `expressions-parse.json` fail on skew.
- **Conformance** (`packages/puzzle-lang/conformance`, `go:embed`ed so Sites
  pins rows at the language tag): `expressions-parse.json` pins every
  expression's S-expression tree with positions, or its positioned error
  (plain, handler and bindings modes; `conformance.ExpressionsParse` +
  `expr.Print`); `functions.json` pins the library. A corpus proof parses
  every `.pzl` expression in the monorepo. `FuzzParse`
  (`expr/fuzz_test.go`) fuzzes from the rows (tree or positioned error, all
  positions in range, stable reparse); `go test` runs the seeds, the fuzzer
  runs by hand. An *evaluation* table (expression + inputs → value) is still
  planned, for Sites.
- **Ports.** The eslint/prettier plugins and the pieces demo's highlighter
  speak this language; their vendored splitter and brace scanner must track
  `packages/puzzle-lang/parser` (e.g. `{#raw}` skipping, `/`-as-division
  rules). Neither lexes tags. The three editor grammars (separate repos) must
  be swept on any grammar change.

## 9. Around the expression

Unchanged by this card: markers, snippets, `{#raw}`, D168 whitespace, keys,
islands, the loop domain (D173 V12), D170 list blocks, V6 printing, the
markup placement rule. Every expression position is one `expr.Parse`, so
headers take any expression (`{#for t in todos.filter(t => !t.done)}`,
`{#if items.length}`), and `{#unless c}` is `!` over the condition.

| Need | Expression |
|---|---|
| count | `x.length` |
| math | `+ - * / %`, `Math.*`, then a function to present |
| fallback | `x ?? y` |
| transform a value | a method or function: `name.toUpperCase()`, `currency(price)` |
| shape a list | array methods |
| app display logic | a registered function |
| a browser value | read it in `data()` |
| the view instance | never |
| run view code | an `@event` handler (PuzzleKit only) |

## Open

- **`tel:` in the `raw` allowlist** — PuzzleKit keeps it on `<a href>`
  (matching Sites' `SanitizeRichText`); unconfirmed for the shared allowlist.
- **`currency` delimiter** — fixed `,` today; whether it should follow the
  locale like `number_with_delimiter` is undecided.

## Alternatives rejected

- **A Puzzle data language with Liquid-style pipes** (`.size` as the count,
  pipes only in display positions, a 27-name formatter set) — custom syntax
  that breaks "it's just JS in the braces", and it drifted in practice: a JS
  deny-list in PuzzleKit and an allow-list parser in Sites disagreed on ~a
  dozen inputs; a token-scanning resolver mis-prefixed Unicode identifiers
  and arrow params. A closed grammar parsed once with one conformance table
  removes that class of drift.
- **Full JS via an engine in Sites** — "it needs to be in Go."
- **Vue's open-ended model** — a Go host cannot evaluate arbitrary JS.
- **Each host accepts its own subset** — that is the drift above; Sites only
  switches entries off.
- **Keep `upcase`/`trim`/`join`… as functions** — two ways to say one thing.
- **`===` only** — `==` keeps its JS meaning; Go implements the coercion.
- **Method call on a missing value as an error** — guarded like a member read.
- **Library wins a bare call in `@event`**, or as a fallback when no handler
  exists — a handler value's own call always names the handler; collisions
  warn.
- **Browser globals as template reads** (`window.scrollY`) — not template
  data, Sites has none, and a bare name would silently read `data()`.
- **Reject every browser global name** — `location` etc. are plausible
  `data()` fields; the method table already stops method calls.
- **`event` as handler-only** — `<EventCard event={ item }>` is ordinary
  data; the real hazard is the §7 compile error.
- **`this.` as a door into the view, even read-only** — bypasses `data()`, has
  no Sites meaning, and produced miscompiles (`this.items.filter(i => …)`).
  Cory: "the templates are set up to have all data pass through data() …
  adding "this" breaks that."
- **`{#let}` in PuzzleKit** — logic belongs in `data()`.
- **`new Date()` and date methods** — "we'll have limited support."
- **Mutating array methods** — an expression must not change what it reads.
- **Unknown literal date preset as an error** — an app's own `date` may take
  presets the compiler cannot see; a warning still catches typos.
- **A shipped `puzzle migrate` codemod** — no outside users; the 0.7 → 0.8
  upgrade checklist is in the CHANGELOG.
- **`functions` config key / `app.function()`** — `formatters` keeps its name.
