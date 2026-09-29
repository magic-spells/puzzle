---
name: 'D173 — Core semantics: one meaning for each shared construct across PuzzleKit and Sites (V1–V18)'
status: built
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DOC-LANGUAGE-CORE
  - DOC-SPEC-TEMPLATE
  - COMPONENT-FORMATTERS
  - COMPONENT-CODEGEN
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-VIEW-MANAGER
  - DECISION-D168-TEXT-RUN-WHITESPACE
  - DECISION-D141-MARKER-FALLBACK-BODIES
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D167-COMPONENT-FAMILIES
notes:
  - kind: deviation
    text: >-
      V6 as built in PuzzleKit: (1) a FUNCTION (and a symbol) is not treated as an "object"; it
      prints as String() would. JS functions are objects, but guarding them costs bytes on every
      interpolation, and no correct template prints one. (2) Every object prints nothing, whatever
      `toString` it defines: a Date, a `URL`, a Decimal (decimal.js/big.js), a Temporal value, a
      Luxon DateTime, any app class with a custom `toString`. Each needs a function or an explicit
      field/method in `data()`. Cory keeps "a Date prints nothing" as built. A Date gets its own
      dev-only warning (format it with date(), datetime() or time()) inside the `__PUZZLE_DEV__`
      block; production displayValue carries no `instanceof Date`. Flag this if Sites treats a date
      as a scalar. (3) V14 applies to snippet stamps too: a stamp that renders nothing shows the
      marker's fallback for that stamp.
  - kind: gotcha
    text: >-
      V14: a marker fallback whose node count differs from the content's still shifts the following
      siblings on each filled/unfilled flip (the positional patcher remounts them). Padding to fix
      it was rejected (+32 B gzip); SPEC §24, D141 and SKILL.md tell authors to keep such a fallback
      to one root element. tests/slot-filled.test.js pins the no-fallback splice that keeps arity
      constant.
---

# D173 — Core semantics: one meaning for each shared construct

Decided with Cory on 2026-09-25. Every item is built in PuzzleKit on
`release/0.8.0`; the expression items (V1, V4's guards, V7, V8) are built as
the expression language, [[DECISION-D176-EXPRESSION-LANGUAGE]]. Sites has
adopted none of it yet. Until an item lands in Sites, [[DOC-LANGUAGE-CORE]]
keeps describing each host's behavior, and its "Known divergences" entry stays
open. The function library (display transforms, sanitized `raw`) is on
[[DECISION-D174-STANDARD-FORMATTERS]].

## Context

[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]] makes Puzzle one template language
with two dialects, PuzzleKit and Sites, under one rule: **a dialect may add or
restrict, never redefine.** [[DOC-LANGUAGE-CORE]] found 18 places (V1–V18)
where the two implementations gave shared syntax different meanings. Each gets
one of four outcomes:

- **Unify**: both hosts behave the same.
- **Host-specific**: the difference is inherent to the host, so the core
  declares it host-defined and tells authors.
- **Restrict**: one dialect rejects the construct for now (the rule allows
  restriction).
- **Fix bug**: one side is simply wrong.

**How the winner is chosen**, in order:

1. **Valid JavaScript keeps its JavaScript meaning.** Template expressions are
   JavaScript-shaped (D176), and an author reads `==` or `.length` the way the
   same file's `<script>` does. The core never redefines a JavaScript
   operator or method. Where Sites differs from JavaScript, Sites changes.
2. **Safer for template authors wins.** A missing value prints nothing rather
   than crashing the view, a missing list loops zero times, and nothing leaks
   `NaN` or `[object Object]` onto the page. PuzzleKit may get there by
   *lowering* template expressions in codegen (a member-access guard, a loop
   guard), because codegen compiles every template expression and no script
   byte changes. Lowering may add safety. It never changes what a valid
   expression evaluates to when nothing is missing.
3. **When neither behavior is safer, Sites changes.** Sites is unpublished;
   PuzzleKit is on npm.

**Corpus for the "templates affected" counts** (heuristic scan on 2026-09-24
of every template section, with `<script>`, `<style>` and `<schema>` removed):
**PuzzleKit**, 593 files (`packages/puzzle/examples`, the scaffold templates,
and the `packages/puzzle-pieces` registry and demo); **PK apps**, 214 files
(`sites/web` and `sites/admin`, real PuzzleKit apps outside this monorepo);
**Sites**, 150 files (`sites/engine/testdata` and `sites/engine/starter`, not
counting the deliberately broken `testdata/themes/errors` fixtures). "None
found" means the scan found no template whose output changes; where the
answer depends on runtime values, the item says so.

## Summary

| Item | Outcome | Host that changes | Breaking | Templates that change |
|---|---|---|---|---|
| V1 expressions | Unify: one expression grammar (D176); a display transform is a function call | both | both | every pipe (PuzzleKit: 136 chains in 92 files) |
| V2 `==` / `!=` | Unify: JavaScript loose equality | Sites | Sites (edge cases) | none found |
| V3 `null` vs `undefined` | Host-specific for strict comparison; `x == null` is the portable absence test | none | no | none found |
| V4 access through absent | Unify: member reads and method calls yield absent, print nothing | PuzzleKit | no | none found |
| V5 arithmetic on non-numbers | Host-specific | none | no | none found |
| V6 value printing | Unify on one printing rule | both | both (edge cases) | none found |
| V7 text units and Unicode | Unify: JavaScript's `.length` and string methods | Sites | Sites | none found in PuzzleKit |
| V8 object literals | Fix bug; object literals join the core | PuzzleKit | no | none found |
| V9 list/object in an attribute | Unify on Sites' rule | PuzzleKit | PuzzleKit | none found |
| V10 whitespace | Unify on a merged rule (D168) | both | both | PK 119 files, PK apps 13, Sites 33 |
| V11 text inside `{#raw}` | Unify on PuzzleKit's rule | Sites | Sites | none found |
| V12 loop domain | Unify: non-lists loop zero times | both | both | none found |
| V13 markers in exclusive branches | Unify: one per render path | shared parser | no | none found |
| V14 when a slot is filled | Unify: filled means it rendered something | both | both | none found |
| V15 how props reach scope | Host-specific, plus script-less PuzzleKit components read props | PuzzleKit | no | none found |
| V16 dotted tags in Sites | Restrict: Sites rejects them for now | Sites | no | none |
| V17 function failure policy | Host-specific | none | no | none found |
| V18 scoped styles, `{#svg}` paths | Styles host-specific; `{#svg}` path unified | Sites | Sites | none found |

## Expressions

**V1 — template expressions are one language, in both hosts.**
- **Every expression position parses as exactly one expression of the D176
  grammar**, by one parser (`packages/puzzle-lang/expr`) that PuzzleKit lowers
  to JavaScript and Sites evaluates in Go: text interpolation, quoted and
  brace-only attribute values, component props, marker arguments, every
  condition header (`{#if}`, `{:else if}`, `{#unless}`, `{#case}`, `{:when}`
  values, an attribute's inline `{#if}`), a `{#for}` collection and range
  bounds, and — PuzzleKit only — an `@event` handler's arguments. Sites'
  `{#let}` value is one more position (a Sites addition).
- **There are no formatter pipes. A display transform is a function call:**
  `{ currency(price) }`, `{ date(post.createdAt, 'long') }`,
  `{ t('cart.items', { count: items.length }) }`. A `|` anywhere is a
  positioned error: `` `| name` pipes were removed — write `name(value)`;
  bitwise OR is not available ``. Cory: "we're making the move to JS dot
  syntax for the same reason that Vue moved away from the filter pipe syntax.
  The js has no learning curve and it makes the syntax less complicated."
- **A call is an ordinary expression, so it works in every position, headers
  included:** `{#for t in todos.filter(t => !t.done)}`,
  `{#if items.length}`. The one placement rule left is markup: `raw` and
  `newline_to_br` render only as the outermost call of a text interpolation
  (D174).
- **`{#unless c}` has one AST shape:** the parser stores the negation of the
  parsed condition, `Unary !` over it.
- **Breaking:** both. A PuzzleKit 0.7 chain becomes a call
  (`{ x | f(a) | g }` → `{ g(f(x, a)) }`), and JavaScript outside the grammar
  (bitwise operators, `typeof`, `new`, assignment, …) is a positioned error
  that names the alternative. Sites' pipes become calls the same way.
- **Templates:** the PuzzleKit corpus was migrated in 0.8.0 by a throwaway
  script (136 chains in 92 files, plus 103 `.size` reads → `.length`); no
  codemod ships, because no one else is on the framework yet (D176 §9 f).

**V2 — `==` and `!=` mean what they mean in JavaScript, in both hosts.**
Cory: "it's valid js so we should allow valid js."
- They join the core with ECMAScript's loose-equality algorithm
  (`IsLooselyEqual`). PuzzleKit is unchanged. Sites implements the algorithm
  in its Go evaluator for `==`/`!=`, where today it treats them as
  `===`/`!==`; shared fixtures pin the cross-type cases (`1 == '1'`,
  `0 == ''`, `null == undefined`, `true == 1`).
- **No compiler warning.** A team that wants strict equality everywhere turns
  on an optional `eqeqeq`-style rule in `puzzle-eslint`.
- **Breaking:** Sites, in edge cases only: a comparison whose operands hold
  different types changes from false to the JavaScript result.
- **Templates:** none found. The 33 Sites uses in 21 files compare a field
  with a string literal, a number literal or another field. Only the ones
  that compare a field with a numeric-looking literal could change
  (`settings.columns == '2'` and its siblings, 8 uses; `settings.count == 2`,
  1 use), and only if the field holds the other type, where the result
  becomes true instead of never matching.

**V3 — `null`, `undefined` and strict comparison.**
- **The portable absence test is `x == null`** (and `x != null`). Under V2 it
  behaves identically in both hosts: true for both spellings of a missing
  value, false for everything else.
- **What `x === null` or `x === undefined` returns is host-defined.**
  PuzzleKit follows JavaScript, so `undefined === null` is false. Sites has
  one absent value in Go and does what it does. The docs tell authors to
  write `== null`. `??` and `?.` already treat both spellings as absent in
  both hosts.
- **`??` is the one way to supply a fallback**: `{ nickname ?? name }`
  replaces only a missing value, so `{ count ?? 'none' }` still prints `0`.
  The docs say a fallback is `??`, not `||` (which swallows `0` and `''`).
- **Changes:** none (docs). **Breaking:** no.
- **Templates:** none found (0 comparisons against a `null` or `undefined`
  literal in any corpus).

**V4 — member access and method calls through a missing value.**
- **Reading a member of a missing value, or calling a method on one, yields a
  missing value, and a missing value prints nothing: an empty string, never a
  word such as "empty".** PuzzleKit codegen guards every member step, index
  step and method call in a template expression (`a?.b?.c`, `a?.[i]`,
  `a?.trim()`), handler arguments included; writing `?.` stays legal and
  becomes unnecessary. A PuzzleKit handler's free `event` chain is the DOM
  event, not template data, and is written as authored (D176). PuzzleKit's
  development warning for an undefined interpolation still points at a typo;
  a method call on a missing receiver draws no warning, because telling it
  apart needs a runtime helper that production would pay for.
- **The `Object` globals take a missing value too.** `Object.keys`,
  `Object.values` and `Object.entries` of a missing value return `[]`, so
  `{ Object.keys(settings).length }` prints `0` instead of failing the view
  with JavaScript's `TypeError`. PuzzleKit's render target passes the
  argument as `<arg> ?? {}`, so a string, a list or any other value reaches
  the global unchanged; `puzzle check` keeps the author's spelling, as it
  adds no `?.`. Sites' evaluator needs the same default for parity.
- **Why:** one missing intermediate object used to throw and send the whole
  PuzzleKit view to error handling. Only codegen changes; scripts stay real
  JavaScript, and a path that exists evaluates exactly as before.
- **Breaking:** no. A render that threw now prints nothing.
- **Templates:** none of the working templates change. Deep paths appear 24
  times in 6 PuzzleKit files and 12 times in 5 PK-app files; those print
  nothing instead of throwing if an intermediate object goes missing.

**V5 — arithmetic and comparison on non-numbers: host-specific.** The core
defines `+ - * / %`, unary `-` and `< <= > >=` for number with number, `+` with
a string operand as concatenation, and ordering for string with string. A Date
orders with `<`/`<=`/`>`/`>=` and subtracts to milliseconds in both hosts
(D176 §9 h). Any other mix is host-defined: PuzzleKit follows JavaScript
coercion; Sites yields a missing value with a warning. Authors coerce in
`data()` (PuzzleKit) or in a `{#let}` (Sites). Arithmetic is always the
operators; there are no arithmetic functions (D174). No template changes (4
PuzzleKit, 2 PK-app and 2 Sites arithmetic expressions, all number with
number).

**V8 — object literals join the core, and PuzzleKit's scoping bug is fixed.**
An object literal is a core value: name keys, quoted keys and shorthand
(`{ k: v, 'q-r': v, s }`), with core expressions as values. A computed key,
spread, method, getter or numeric key is a positioned error, and so are
`__proto__`, `constructor` and `prototype` as keys. Its usual place is a
function argument: `t('cart.items', { count: items.length })`. An expression
position cannot start with one, where `{ {` reads as a doubled interpolation
brace; PuzzleKit's error says to pass it as a function argument or build it
in `data()`. PuzzleKit lowers the values only and expands shorthand
(`s` → `s: <s>`); the 0.7 resolver scoped the keys too, emitting
`{__d.height: 480}`, invalid JavaScript that only the bundler caught. Sites'
image functions take option objects (4 starter uses, unchanged). Not breaking.

## Rendering, whitespace, escaping

**V6 — value printing, one rule in both hosts.** A missing value prints
nothing. Booleans print `true`/`false`. Numbers print by ECMAScript
Number::toString (the shortest round-trip decimal, exponent form at or above
1e21 and below 1e-6). `NaN` and ±Infinity print nothing. A list prints its
items by this same rule, joined with `,`. An object prints nothing and raises
a development warning; a Date is an object, so it prints nothing and its
warning says to format it with `date()` (or `datetime()`, `time()`).
PuzzleKit changes its runtime text coercion (non-finite numbers and objects);
Sites changes its exponent range and object printing. Breaking in edge cases
for both; no template found prints a non-finite literal or an object.

**V9 — a list or object in a brace-only attribute.** On an element, a list is
an attribute token list: its items print by V6 and join with single spaces, and
`false` and every item that prints nothing (`null`, `undefined`, `''`, and
anything else V6 prints as nothing) are dropped. So `class={ classes }` takes a
list, and the clsx idiom `class={ [active && 'on', 'btn'] }` writes
`class="btn"`, never `class="false btn"`. An object omits the attribute and
raises a development warning. Text interpolation keeps V6's plain comma join
(`false` prints, empty items stay as empty slots), and a list passed as a prop
stays a list. PuzzleKit changes `setAttr` stringification (breaking: a list
attribute joined with commas now joins with spaces). None found: the one
brace-only list literal in PuzzleKit (`InputOtpDoc.pzl`, `{ [3, 3] }`) is a
prop.

**V10 — whitespace: the merged rule, in both hosts.** Cory: "Yes this is a
real bug. I agree with the merged rule." The rule is stated in full on
[[DECISION-D168-TEXT-RUN-WHITESPACE]], which owns it: whitespace without a
newline collapses to one space; newline-bearing whitespace at a parent's
first- or last-child edge is dropped; between two elements it is dropped;
between text or an interpolation and an element it collapses to one space;
between text or an interpolation and a control block it keeps one space; and
`<pre>`/`<textarea>` bodies are preserved exactly.
- **PuzzleKit changes:** text next to an element, and `<pre>`/`<textarea>`.
  **Sites changes:** element-to-element gaps and the control-block boundary.
- **Templates:** PuzzleKit, about 965 line breaks between text and an inline
  element in 119 files (mostly puzzle-pieces demo prose), which gain the
  space they are missing today, plus 9 files with `<pre>` or `<textarea>`.
  PK apps: 7 such line breaks in 7 files, and 6 files with `<pre>` or
  `<textarea>`. Sites: 29 inline-sibling line breaks in 14 files lose their
  gap, and 30 interpolation-to-block line breaks in 19 files gain a space.

**V11 — text inside `{#raw}` follows the core text rule** and is not
entity-decoded. Sites escapes `&`, `<` and `>` in raw-block text, except inside
`<script>` and `<style>`, where both hosts write the text verbatim. Markup
inside `{#raw}` stays markup in both. Sites changes (breaking); its 2 raw
blocks, both fixtures, contain neither `&` nor a text `<`.

## Components, slots, loops

**V12 — a missing list loops zero times.** `{#for x in c}` iterates lists; the
collection is any expression, so `{#for t in todos.filter(t => !t.done)}`
shapes the list in the header. A missing collection runs zero times with no
warning. Any other non-list (a string, an object, a number) runs zero times
with a development warning, in both hosts. Range bounds are truncated toward
zero, with a development warning when a bound was not an integer, and a
missing bound runs the range zero times. PuzzleKit guards the collection in
codegen and `listRows` (template code, not script); Sites changes its
non-integer-bound handling (it rendered nothing). Breaking for both: a
PuzzleKit loop over a string's characters stops, and Sites bounds truncate.
None found: every loop in every corpus iterates a list-shaped path, and all 18
range loops use integer literals.

**The loop index** is `{#for item in items, i}` in both hosts (0-based), and
`{#for 1...n, x}` binds the current number. `loop.first` / `loop.last`
helper variables are not planned for now; compare the index (`i === 0`,
`i === items.length - 1`).

**V13 — at most one default marker per render path.** A default marker
(`<Children/>` or a bare `<Slot/>`), and a `<Slot name="x">` for any one name,
may appear once on any single render path. Two markers in mutually exclusive
branches of one `{#if}`/`{:else}` or `{#case}` are legal, so
`{#if compact}<div><Children/></div>{:else}<section><Children/></section>{/if}`
works. Markers inside loops (the snippet pattern) keep today's rules. The
check lives in the shared parser (`walkBranches` in
`packages/puzzle-lang/parser/slot.go`, the "duplicate default marker" error),
so one change serves both hosts. Not breaking; no file has two default markers
except a Sites error fixture that puts both on one path, which stays an error.

**V14 — a slot is filled when its content renders something.** A position is
filled when the content supplied for it renders at least one node that is not
whitespace-only text. A call-site `{#if}` that renders nothing, and a `{#for}`
over an empty list, both leave the position unfilled, so the fallback body
from [[DECISION-D141-MARKER-FALLBACK-BODIES]] shows in both hosts. That gives
the empty-state pattern for free: `<List>{#for}…{/for}</List>` with a fallback
of "Nothing here yet". PuzzleKit runs the test in one helper, `fill()` in
`viewManager.js`, and only when the marker has a fallback; a marker without
one splices the supplied nodes through, placeholders included, so its arity
stays constant when a call-site `{#if}` toggles. Sites renders the call-site
content first and falls back when the result is whitespace-only. Breaking for
both; none found (0 call sites whose only content is a block, passed to a
component whose marker has a fallback).

**V15 — how a component reads its props: host-specific, plus one PuzzleKit
addition.** A PuzzleKit component with no `<script>` gets a synthesized
`data(params, props)` that returns its props, so `{ tone }` reads the prop, as
in Sites. A component with a script keeps PuzzleKit's rule: its `data()`
decides. Not breaking; PuzzleKit has 1 script-less file, with no
interpolations.

**V16 — dotted component tags are a Sites restriction for now.** The tag
grammar stays core and the shared parser accepts `<Frame.Wrapper>`. Sites
rejects a dotted tag with a positioned error saying component families are
not supported in Sites yet. Cory: "haven't gotten that far with Sites yet.
It'll probably be more simple." Not breaking: no Sites file could back a
dotted tag before. PuzzleKit's barrel resolution
([[DECISION-D167-COMPONENT-FAMILIES]]) is unaffected.

## Host-specific declarations

**V7 — text units and Unicode: JavaScript's, in both hosts.** The count of a
string or a list is `.length` ([[DECISION-D176-EXPRESSION-LANGUAGE]]), and a
string's `.length` counts UTF-16 code units, as JavaScript does. The string
methods in D176's table (`slice`, `at`, `indexOf`, `toUpperCase`, `trim`, …)
keep their JavaScript meaning, so Sites' Go reimplementation indexes by UTF-16
unit, applies JavaScript's full case mapping (`'ß'.toUpperCase()` is `SS`) and
trims JavaScript's whitespace set; conformance rows pin each. `.size` is not
special: it reads a field named `size` like any other member. `truncate`
(D174) counts code points, so on a string outside the Basic Multilingual Plane
(an emoji) it and `.length` disagree by design — `truncate` never splits a
character. PuzzleKit is unchanged (its templates always had JavaScript's
`.length`); Sites changes from counting runes (breaking for non-BMP text).

**V17 — function failure policy.** Each host sets its own policy for an
unknown function name, a wrong argument count and out-of-domain input. Sites
fails the compile, or warns and prints nothing. PuzzleKit passes the value
through and logs a development error (naming the replacement when the name was
removed from the library), because app functions are registered in JavaScript
at runtime, out of the compiler's sight; `puzzle check` types each standard
function's arguments, and a string-literal date preset or time zone the
library does not know is a compile error (D174). The in-domain behavior of the
standard set is pinned by D174.

**V18 — scoped styles and `{#svg}` paths.** Scoped styles are host-specific:
the stamping algorithm is shared, the attribute prefix and stamp target are
host-defined. The `{#svg}` path is unified: it is relative to the host's
assets root in both hosts. Sites stops accepting an explicit `assets/` prefix
(it named `app/assets/assets/x.svg` in PuzzleKit) and makes it a compile error
steering to the bare path. Sites changes; no `{#svg}` path in any corpus uses
the prefix.

## Alternatives rejected

- **V1: a formatter pipe language** — `{ price | currency }` in display
  positions, with a pipe banned in condition and `{#for}` headers, a nested
  `|` an error, and each segment after a pipe a formatter name. Rejected for
  D176: pipes are a second syntax beside JavaScript that authors must learn
  (Vue dropped its filters for the same reason); `|` collides with bitwise OR,
  which forced a nested-pipe error and a "wrap it in parentheses" fix-it; the
  header bans (Cory then: "I don't like the idea of formatters being mixed in
  with logic conditions", "No formatters in for loop headers in both") needed
  a separate rule per header and pushed list shaping out to `data()` or a
  `{#let}`; and a chain needed its own AST fields (`DynamicAttr.Formatters`)
  that every host and port had to apply or silently drop. A function call is
  JavaScript, needs no header rule, and has one AST shape.
- **V1: a nested `|` is a bitwise OR.** Rejected: it let
  `@click={ save(x | trim) }` compile silently to `save(__d.x | __d.trim)`.
  The grammar has no bitwise operators at all.
- **V2: `==` means `===` in templates.** Rejected: a PuzzleKit template's
  `==` would mean something different from the same file's `<script>`, which
  redefines valid JavaScript.
- **V2: the core rejects `==`/`!=` with a fix-it steering to `===`.**
  Rejected: it forbids valid JavaScript. Teams that want that get it from the
  optional `puzzle-eslint` rule instead.
- **V3: PuzzleKit lowers `=== null` / `=== undefined` to `== null`.**
  Rejected for the same reason as V2: it changes the result of a valid
  JavaScript expression. `== null` already gives the portable test.
- **V4: make `?.` mandatory in the core.** Rejected: it keeps a crash in
  PuzzleKit for any author who forgets `?.`, and turns every existing Sites
  path into non-core syntax.
- **V5: unify on Sites through runtime helpers.** Rejected: work on every
  render in the hottest code, for inputs no correct template produces;
  development-only helpers would make production behave differently.
- **V7: `.size` as the count, in code points** (a PuzzleKit helper that
  counted code points on a string and items on a list, with `.length` a
  compile error). Rejected for D176: `.size` is not JavaScript's count, so it
  broke "drop JavaScript in the braces and it works"; it shadowed a record's
  own `size` field (the 0.8.0 migration found seven, such as a file's byte
  size); and it cost a runtime helper. Sites counts UTF-16 units instead.
- **V7: `.length` in UTF-16 units in PuzzleKit and in code points in Sites.**
  Rejected: the two hosts would count the same string differently.
- **V10: one host's whitespace rule wholesale.** PuzzleKit's keeps the glued
  prose (`tokens —a,band more`) and makes authors write `{ ' ' }`. Sites'
  brings back indentation gaps between inline-block siblings. See D168.
- **V12: Sites' "render nothing" for non-integer bounds.** Both are safe; the
  tie-break keeps the published behavior.
- **V14: a static rule, where any authored content that is not whitespace
  fills the position.** Rejected: it gives no empty-state behavior, and
  PuzzleKit's old split (a false `{#if}` filled, an empty `{#for}` did not)
  was a side effect of the `{#if}` placeholder node, not a design.
- **V16: map a dotted tag to a Sites file now**, as `Frame.Wrapper.pzl` in the
  flat folder or `Frame/Wrapper.pzl` in a folder per family. Rejected for
  now: Sites has no need for families yet, and its eventual design will
  probably be simpler. Lifting the restriction later is an addition.
- **Leave everything host-defined.** Rejected: it contradicts D172. Host-
  defined is kept only where the difference is inherent to the host (V3's
  strict comparison, V5, V15, V17 and the V18 styles).

## Build

**PuzzleKit — built on `release/0.8.0`.** The groups landed as separate
feature branches, in this order across D173 and D174: (a) the standard set
(D174), (b) expressions and loops, (c) whitespace, (d) slot rules, (e)
sanitized `raw` (D174), (f) value printing, (g) standard-set alignment (D174);
the expression language (D176, phases P1–P4) then replaced (b)'s pipe rules.
Where each item lives:
- V1, V4, V8: `packages/puzzle-lang/expr` (grammar, positioned errors) and
  `compiler/internal/codegen/lower.go` (lowering, guards).
- V6, V9: `client-runtime/views/display.js` (`displayValue`), `setAttr`, and
  the SSG serializer's `serializeAttrs`, which must print the same.
- V10: `compiler/internal/codegen/codegen.go` (D168).
- V12: codegen's loop guard plus `client-runtime/views/listBlock.js`.
- V13: `packages/puzzle-lang/parser/slot.go`. V14: `viewManager.js` `fill()`.
- V15: codegen synthesizes `data(params, props)` for a script-less component.

Items that touch `packages/puzzle-lang` (V1, V13) must also reach the vendored
ports in `packages/puzzle-eslint` / `packages/puzzle-prettier`, the three
editor grammars (puzzle-vscode/sublime/zed) — D176 P5 — and Sites' next parser
sync.

**Sites (later, its own repo and cards):**
- Evaluator (D176 P6): the expression grammar and function library in Go,
  JavaScript loose equality (V2), UTF-16 `.length` and JavaScript-exact string
  methods (V7), value printing (V6).
- Renderer: whitespace (V10), raw-block escaping (V11), loop bounds (V12), the
  slot-filled rule (V14), the `{#svg}` prefix error (V18), and the dotted-tag
  error (V16).
- The one starter-theme output change is whitespace (V10); its pipes become
  function calls (V1).

**Shared:** a conformance fixture for every unified item, run by both hosts
(`packages/puzzle-lang/conformance`). It is the only real proof that a unified
item is identical.

**Breaking changes:**
- PuzzleKit: 6 (V1, V6, V9, V10, V12, V14). V1 changes the source of every
  piped template; V10 changes output, and there it fixes glued prose.
- Sites: 9 (V1, V2, V6, V7, V10, V11, V12, V14, V18). V1 changes the source of
  every piped template; only V10 changes the output of existing templates.
