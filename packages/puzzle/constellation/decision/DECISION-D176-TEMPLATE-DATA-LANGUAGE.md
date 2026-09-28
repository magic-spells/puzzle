---
name: >-
  D176 — Template expressions are a data language, not JavaScript: `.size`, operators, `??`, pipes
  only where a value is displayed
status: built
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DOC-LANGUAGE-CORE
  - DOC-SPEC-TEMPLATE
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-FORMATTERS
  - RELEASE-V0-8-0
---

# D176 — Template expressions are a data language, not JavaScript

**Status: adopted and built for PuzzleKit (2026-09-28, one PR into
`release/0.8.0`).** Decided with Cory; the in-place edits listed under
*Changes to existing cards* are made. Rule 5's `this` rejection is building on
`feat/remove-this-from-templates` (build list item 9). The Sites half of the
build list is open in its own repo.

## Context

D172 made Puzzle one language with two dialects, and D173 gave each shared
construct one meaning. One split survived: **what a template expression is.**
Sites evaluates a fixed subset in Go (paths, literals, operators, `.length`,
no calls). PuzzleKit pastes the expression into JavaScript, so it also accepts
`name.toUpperCase()`, `items.filter(i => i.done)`, `Math.round(x)`, arrow
functions, template literals and bitwise operators. The same author, moving
between a PuzzleKit view and a Sites section, cannot tell from the syntax
which things will work: `user.first_name` is a string in both, but
`user.first_name.length` and `user.first_name.trim()` are "JavaScript that
happens to run" in one and an error or nil in the other.

The Liquid heritage adds a second split. Liquid has no operators, so counting
and arithmetic are filters. Puzzle has operators, so the 0.8.0 standard set
carried two ways to do the same thing: `tags.length` / `tags | size`,
`a + b` / `a | plus(b)`, `x ?? y` / `x | default(y)`. Cory: the arithmetic
formatters "make the code look archaic and bloated"; the goal is to read
`users.size - 100` and use direct math.

A corpus scan (2026-09-28: PuzzleKit examples, scaffold, tests, pieces,
devtools, Sites themes and Sites' admin app) sized the two splits:

| Construct | Uses |
|---|---|
| `.length` | ~160, in every corpus including 17 in Sites themes |
| `\| size`, `plus`/`minus`/`times`/`divided_by`/`modulo`/`default` | 0 |
| a pipe inside an `{#if}`/`{#case}` condition | 0 real (1 test fixture) |
| method calls on data (`draft.trim()`, `set.has(x)`) | 7 |
| `String(x)` | ~10 |
| `this`, arrow functions, template literals, `Math.*` | 0 |

The JavaScript-only surface is used about 17 times in total. The duplicate
formatters are used zero times.

## Decision

**A template expression is data plus operators. Anything that computes from a
value is a formatter, and a formatter appears only where a value is
displayed.** PuzzleKit enforces this at compile time with the same errors
Sites gives, so a template that compiles in one dialect is the same language
in the other. A template expression never reaches the view instance: `this`
is not a template identifier, and PuzzleKit's one door into JavaScript is the
`@event` handler.

### 1. Values are JSON-shaped, and `.size` is the one built-in property


- A template value is an object, a list, a string, a number, a boolean or a
  missing value. An expression reads fields (`a.b`, `a?.b`, `a[expr]`) and
  combines them with operators. Record fields, computed fields and
  relationships are fields.
- **`.size` is the count of a list (items) or a string (code points).** It
  replaces both `.length` and the `size` formatter. It counts the same in both
  hosts: Sites already counts code points; PuzzleKit compiles `x.size` to a
  small helper (`sizeOf`, exported from the package root and imported as
  `__z` only by a module that uses it), so a JavaScript array's UTF-16
  `.length` is never what a template sees. `.size` and `truncate` therefore
  agree on what a character is (a code point, not a grapheme cluster; a
  family emoji is still several).
- **An object has no count.** `.size` on an object is an ordinary field read
  (`file.size`, `image.size` keep working; a Map or Set answers its own
  `size`). A list or string cannot have fields, so there is no precedence
  rule to learn: on a list or string `.size` is its count, on anything else it
  is the field. The helper implements exactly that, and `puzzle check` types
  it the same way (a number for a list or string, the field's type for an
  object).
- **`.length` is a positioned compile error in both dialects** — "`.length`
  is not part of the template language — use `.size`". Without the error,
  JavaScript arrays would keep answering `.length` in PuzzleKit and not in
  Sites, which is the split this card removes. A data field genuinely named
  `length` is reachable as `obj['length']`.
- `.size` is a property, not `.size()`: a call form would be the one method
  call the language allows, contradicting rule 3 and inviting `.trim()` next
  to it, and it would need a special case in both parsers.
- Because it is a field on an object, `value={ product.size }` auto-binds
  like any `ident.ident` path (D147): the control displays the field through
  the helper and writes it back. Binding the count of a list or string is
  meaningless and gets no special case.

### 2. Operators compute; `??` is the default operator

- Math is `+ - * / %` on the value, then a formatter presents the result:
  `{ price * (1 - discount) | currency }`, `{ total / count | round }`. The
  base of a pipe is any expression; the chain comes after it.
- **`??` is the one way to supply a fallback**: `{ nickname ?? name }`. It
  replaces only a missing value (`null`/`undefined`), so `{ count ?? 'none' }`
  still prints `0`. `||` stays logical OR for conditions; the docs say
  explicitly that a fallback is `??`, not `||` (JavaScript's `||` swallows `0`
  and `''`, and Liquid's `default` behaves the same way).
- **Removed from the standard set:** `size` (now the property), `plus`,
  `minus`, `times`, `divided_by`, `modulo` (operators) and `default` (`??`).
  `round`, `floor`, `ceil`, `abs` stay: they have no operator form.
- **`split` becomes Sites-only.** It produces a list, and in PuzzleKit a list
  can only be displayed (joined) since a pipe cannot feed a `{#for}`; the
  split belongs in `data()`. Sites keeps it for `{#let parts = tags | split(',')}`.
  `join` and `json` stay standard (list → text is display).

### 3. No calls on data values, in either dialect

A template never calls JavaScript on a value. In PuzzleKit these are
positioned compile errors, worded as Sites words them ("… are not available in
template expressions"), each naming the replacement:

| Rejected | Replacement |
|---|---|
| `name.toUpperCase()`, `s.trim()`, any `.method(`) | a formatter (`\| upcase`, `\| trim`), or compute it first |
| `Math.round(x)`, `String(x)`, `Number(x)`, `JSON.stringify(x)`, any `name(` | `\| round`; display coercion is automatic (D173 V6); compute it first |
| `items.filter(i => i.done)`, any `=>` | compute it first |
| `` `${a} ${b}` `` | `{ a } { b }` or `a + ' ' + b` |
| `new`, `typeof`, `instanceof`, `in`, regex literals, `++`/`--`, assignment, the comma operator | not template concerns; compute it first |
| bitwise `\| & ^ ~ << >>` | not in the language; a nested `\|` is an error (rule 4) |

"Compute it first" is the one idiom, with one spelling per dialect: a
`data()` field in PuzzleKit, `{#let}` in Sites. `items.at(-1)` (named in D174
as a plain-expression replacement) is a call and goes too; it is
`items[items.size - 1]`.

Formatter calls (`| truncate(20)`) and `@event` handler bodies are not
expressions on data values and are unaffected. The check is a separate
codegen pre-pass (`compiler/internal/codegen/datalang.go`) over every value
position — text, attributes, inline-if branches, props, marker arguments,
`key=`, block subjects, `{:when}` values, `{#for}` collections and range
bounds, formatter arguments, and the condition of a handler ternary — with
strings, regex bodies and comments opaque. The same pass rejects `this` in
every one of those positions and in handler arguments (rule 5).

### 4. A pipe appears only where a value is displayed

- **Allowed:** text interpolation, quoted and brace-only attribute values, an
  attribute's inline `{#if}` branches' text, component props, marker
  arguments, `key=`, a controlled `value=` (as a one-way display value), and
  Sites' `{#let}` value.
- **Rejected, positioned error in both dialects:** the `{#if}`, `{:else if}`,
  `{#unless}` and `{#case}` subjects, `{:when}` values and `{#for}` headers
  (the last two were already errors). The fix-it: name the transformed value
  first (`data()` / `{#let}`), then branch on a plain expression.
  `{#if tags | size}` becomes `{#if tags.size > 0}`; `{#case status | downcase}`
  becomes `{#let status = member.status | downcase}` / a `data()` field, then
  `{#case status}`.
- **A `|` that is not at the top level of the value is an error**, not a
  bitwise OR: `@click={ save(x | trim) }` and `disabled={ !(draft | trim) }`
  no longer compile to `save(__d.x | __d.trim)`. Trim it in `save()`, or
  compute the flag first. In an `@event` value any `|` is the error. This
  also retires the "parenthesize a bitwise OR" fix-it: there is no bitwise OR
  in the language.
- `{#unless}` therefore has one AST shape: the parser folds the negation into
  `Cond` as `!(…)` and the `Negate` field goes.

### 5. One door into JavaScript: handlers

- **A template expression never reaches the view instance.** `this` is not an
  identifier in any template expression: interpolation, attribute value,
  `{#if}`/`{#unless}`/`{#case}`/`{:when}` condition, `{#for}` header, `key=`,
  formatter argument, marker or prop argument, inline `{#if}`, skeleton — and
  `@event` handler arguments and handler ternary conditions too. Writing it is
  a positioned compile error at the `this` token: "`this` is not available in
  template expressions — return the value from data() (a getter or a computed
  field), or use a formatter for a display transform". `this?.`, `(this)` and
  `this[…]` get the same error; a field named `this` (`x.this`) is an ordinary
  member read.
- **Every value a template shows comes through `data()` and the model; a
  display transform is a formatter.** A flag or a derived value is a `data()`
  field (`canAdd: draft.trim() !== ''`), and a relative time is a formatter
  (`{ createdAt | timeago }`). A template that compiles in PuzzleKit therefore
  never depends on a view instance, which is what lets the same template be
  core Puzzle for Sites, which has none.
- **`@event={ handler(args) }`** — the one door: a fire-time JavaScript call
  that reaches the view through the handler's own name (`@click={ save(x) }`
  calls the view's `save`); nothing else in a template reaches the view. The
  arguments are JavaScript evaluated at fire time:
  `@click={ pick(todo.tags.size) }` reads the plain `size` property (undefined
  on an array), and the JavaScript count is `.length` there. The handler
  ternary's condition is a data expression.
- The handler is a dialect extension in the D172 sense, like `<Portal>`: Sites
  rejects `@event` with an error that says so.
- **No `{#let}` in PuzzleKit.** Cory: it "would allow people to put logic in
  the templates instead of in the JS and that's an anti-pattern for PuzzleKit
  but a necessity for Puzzle Sites." The docs state the mapping once:
  Sites `{#let x = …}` ⇔ PuzzleKit `data()` field.

### After D176, one answer per question

| Need | Both dialects |
|---|---|
| count of a list or string | `x.size` |
| math | `+ - * / %`, then a formatter to present |
| fallback | `x ?? y` |
| transform a displayed value | `{ x \| formatter }` |
| branch on a transformed value | compute it first, branch on the name |
| shape a list | `data()` (PuzzleKit) / `{#let}` + list formatters (Sites) |
| reach the view instance | never: `this` is not a template identifier |
| run JavaScript | an `@event` handler (PuzzleKit only) |

## Alternatives

- **Keep `.length`, drop the `size` formatter.** Both dialects already agreed
  on `.length`, it composes, and it is the 160-use idiom. Rejected: `.length`
  reads as "this is JavaScript", which invites `.trim()` beside it and hides
  that `.length` on a string counts UTF-16 units in one host and code points
  in the other (D173 V7 accepted that difference). `.size` is the word Puzzle
  already used for the count, and the helper makes the count identical.
- **Force `| size` everywhere (no count property).** Rejected: a pipe only
  works at the top level of a value, so `{#if users.size > 0}`,
  `i === items.size - 1` and `{ count + tags.size }` become impossible without
  `{#let}` in PuzzleKit, which rule 5 refuses.
- **`.size()` as a call.** Rejected (rule 1).
- **Keep pipes in `{#if}`/`{#case}` subjects** (D173 V1 as first written:
  "`{#if post.tags | size}` is short and useful"). Rejected: with `.size` a
  property, the one real use is gone, no template used the form, and it gave
  two ways to branch on a transformed value and two AST shapes for
  `{#unless}`.
- **Keep the arithmetic formatters and `default` for Liquid familiarity.**
  Rejected: zero uses, and two ways to add two numbers. `??` is one habit a
  Liquid author relearns, and it is the safer one.
- **Keep JavaScript on data values in PuzzleKit and only document the core.**
  Rejected: that is the 0.8.0 state, and documentation does not stop
  `draft.trim()` from being the thing an author types first.
- **Add `{#let}` to PuzzleKit so both dialects share the compute-first
  spelling.** Rejected (rule 5).
- **`this.` as a door into the view** — `{ this.ago(createdAt) }`,
  `disabled={ !this.canAdd }`, with the whole chain JavaScript and calls
  allowed through it. Rejected: it bypasses `data()`, the one path data takes
  into a view, and Sites has no view instance, so it could never be core. In
  review it produced an arrow-parameter miscompile
  (`this.items.filter(i => i.done)` compiled to invalid JavaScript), a silent
  `.size` trap (`{#if this.items.size > 0}` is always false, because the chain
  is JavaScript and an array has no `size`), and a host-only escape hatch. Its
  only uses in the shipped corpus were three `disabled={ !this.getter }`
  flags, each expressible as a `data()` field. Cory: "lets remove this from
  templates, we don't need it, the templates are set up to have all data pass
  through data() and go into the model and then get rendered in the view
  template. I feel like adding "this" breaks that and lets them call the
  object directly and that's an anti-pattern in PuzzleKit and can't be used at
  all in Puzzle-lang in Sites."
- **Keep `this` as a data-language root (reads only, calls rejected).**
  Rejected: still a second path into the view; `data()` is the path.
- **Warn in 0.8.0, error in 0.9.** Rejected: 0.8.0 is already the breaking
  template release with an upgrade checklist, and the whole-monorepo cost is
  ~17 expressions plus a mechanical `.length` → `.size` sweep.
- **Type `__z` as `number | undefined` in `puzzle check`.** Rejected: under
  strict mode every `items.size > 0` would report "possibly undefined"; the
  overloads give a number for a list or string and the field's type for an
  object.

## Consequences

- **Breaking for PuzzleKit templates.** `.length`, calls on data, arrows,
  template literals, bitwise operators, nested pipes, pipes in conditions and
  `this` anywhere in a template (handler arguments included) stop compiling;
  the eight formatters are gone (the unknown-name guard names each
  replacement). The CHANGELOG's "Upgrading from 0.7" checklist gains the
  rows. The scaffold's `disabled={ !newTodoText.trim() }` is `go:embed`ed, so
  the fix ships only with rebuilt binaries.
- **Sites:** `.length` becomes the same compile error; `.size` on a string
  keeps counting runes (already code points); `size`, the arithmetic
  formatters and `default` are removed from its standard registry; pipes are
  rejected in `{#if}`/`{#case}` subjects. `{#let}` already accepts a chain.
  Sites is unpublished, so none of this is a Sites upgrade.
- **The parser (puzzle-lang) carries the pipe-position and nested-pipe rules
  for both dialects.** The call/arrow/literal rejection is PuzzleKit codegen's
  (Sites' expression parser already rejects them), applied where codegen
  resolves a template value: text, attributes, props, subjects, `key=`.
  Handler bodies are exempt from it; `this` is rejected everywhere, handler
  arguments included.
- **`.size` costs one helper call per count read** (the helper is ~30 B gzip
  once, plus a few bytes per site). Row-cache facts (D170) treat `x.size` as
  a field read of `x`, exactly as `x.length` was: `todo.size` is the field
  `size`, `todo.tags.size` is a deep read. Calls on items and on globals are
  not possible in a value, and handler arguments record no row facts, so no
  template reaches the call-on-item fact path. No template expression reaches
  the view instance either, so a site is `volatile` only through a
  clock-reading formatter (`timeago`) or a mutable-global read (while
  `jsGlobals` exists), plus D170's structural cases (an enclosing site's loop
  local, a root past the mask cap).
- `puzzle check` maps `__z(` as inserted text and the authored `.size` to the
  `)`, so a diagnostic after the step still lands on the author's bytes.
- The "parenthesize a bitwise OR" fix-it, D173 V7's `.length` clause, D174's
  `size`/`plus`/…/`default` rows and its `items.at(-1)` advice are retired.

### Changes to existing cards (in place, done)

- **D172:** the core expression language sentence becomes "paths, literals,
  `.size`, arithmetic, comparison, `&&`/`||`/`??`, ternary; no calls". The
  dialect table's PuzzleKit *Expressions* row becomes "the core, plus the
  `@event` handler; `this` is not a template identifier".
- **D173 V1:** pipe positions are display positions only; the subjects join
  `{#for}`/`{:when}` as errors; a nested `|` is an error; the "bitwise OR"
  fix-it goes; the "keep every block header plain" rejection flips to
  adopted, with the reason above. **V7:** `.size` counts code points in both
  hosts; `.length` is an error; the UTF-16 clause goes. **V8's** `items.at(-1)`
  mention, if any, becomes `items[items.size - 1]`.
- **D174:** the standard set drops to 27 names (`size`, `plus`, `minus`,
  `times`, `divided_by`, `modulo`, `default` out; `split` moves to Sites-only);
  the *Removed names* section lists them with the replacement each guard
  names; `items.at(-1)` becomes `items[items.size - 1]`.
- **DOC-LANGUAGE-CORE / DOC-SPEC-TEMPLATE §6:** the *Access* paragraph
  (`.size`, no `.length`), the operator table's note on `??` vs `||`, the
  *Not in the core* list gains "and PuzzleKit enforces it", the formatter
  paragraph's position list, and the one-line Sites `{#let}` ⇔ `data()`
  mapping.
- **COMPONENT-CODEGEN / COMPONENT-TEMPLATE-PARSER / COMPONENT-FORMATTERS:**
  the new checks, the `__z` helper, the registry changes.
- **Rule 5 (`this`):** D170's volatile-row list loses its `this` case (a row
  that must follow the clock or other ambient state reads a `data()` field);
  DOC-LANGUAGE-CORE, DOC-SPEC-TEMPLATE §6/§28/§31, DOC-TEMPLATE-SYNTAX,
  DOC-USER-GUIDE, DOC-EVENTS, DOC-VIEW-LIFECYCLE, DOC-RELEASE-SURFACE, D62, D72
  and COMPONENT-CODEGEN state the one door, and their template snippets read
  `data()` fields instead of `this.` getters.

## Build list

1. **Built.** puzzle-lang parser: reject a pipe in `{#if}`/`{:else if}`/
   `{#unless}`/`{#case}` subjects; reject a `|` below the top level of any
   value (`nestedPipeIndex` in `scan.go`, checked by `parseChain`); fold
   `{#unless}` to one shape; positioned messages with the fix-its above.
2. **Built.** Codegen: `.size` → `__z(base)` with `sizeOf` exported from the
   package root (imported only when used); `.length` error; call/arrow/
   template-literal/`new`/`typeof`/regex/bitwise rejection on data values
   (`datalang.go`), exempting formatter calls and handler bodies; row-fact
   treatment of `.size`; the `puzzle check` shim's `__z` overloads and source
   mapping.
3. **Built.** Runtime: `client-runtime/size.js`; the eight formatters leave
   `builtins.js`, `builtins.json` and the manifest; the D43 guard's
   replacement table.
4. **Built.** Conformance table: the removed rows are gone.
5. **Built.** Sweep: every `.length` → `.size` and the JS expressions across
   examples, scaffold templates, tests, fixtures, pieces, devtools; goldens
   and compiled fixtures regenerated; the agent skill and README snippets.
6. **Built.** Docs: CHANGELOG checklist rows, the card edits above,
   DOC-RELEASE-SURFACE.
7. Sites (separate repo, after this lands): `.length` error, registry
   removals, pipe-in-subject rejection, `.length` → `.size` sweep in themes
   and its admin app.
8. **Confirmed.** Editor grammars and the eslint/prettier ports: no lexer
   change (the ports vendor the section splitter and token lexer only; the
   rules live in the chain parser and codegen).
9. **Building** (`feat/remove-this-from-templates` → `release/0.8.0`): reject
   `this` in every template expression — handler arguments and the handler
   ternary condition included — with the rule 5 message; drop the `this`
   chain exemption in `datalang.go`, the `this`-root handling in the resolver
   and the `this`-reads-volatile row fact; move the three corpus uses
   (typed-todos `Home.pzl`, chat `Composer.pzl`, blog `PostDetail.pzl`) into
   `data()`; the CHANGELOG checklist row, the agent skill and the README.
