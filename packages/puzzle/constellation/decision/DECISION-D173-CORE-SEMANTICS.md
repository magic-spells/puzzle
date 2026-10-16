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
---

# D173 — Core semantics: one meaning for each shared construct

[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]] makes Puzzle one template language
with two dialects under one rule: **a dialect may add or restrict, never
redefine.** This card fixes the meaning of the 18 shared constructs (V1–V18)
where PuzzleKit and Sites once differed. All of it is built in PuzzleKit; the
expression items (V1, V4, V7, V8) are the expression language,
[[DECISION-D176-EXPRESSION-LANGUAGE]]; the function library is
[[DECISION-D174-STANDARD-FORMATTERS]]. **Sites has adopted none of it yet**
(see *Sites, pending*); until it does, [[DOC-LANGUAGE-CORE]] keeps each
host's behavior and its "Known divergences" entries stay open.

## How a rule is chosen

1. **Valid JavaScript keeps its JavaScript meaning.** An author reads `==` or
   `.length` the way the same file's `<script>` does; the core never
   redefines a JavaScript operator or method.
2. **Safer for template authors wins**: a missing value prints nothing, a
   missing list loops zero times, nothing leaks `NaN` or `[object Object]`.
   PuzzleKit gets there by *lowering* template expressions in codegen (member
   guards, loop guards) — lowering may add safety, never change what a valid
   expression evaluates to when nothing is missing. No script byte changes.
3. **When neither is safer, Sites changes** (unpublished; PuzzleKit is on npm).

Host-defined is allowed only where the difference is inherent to the host:
V3's strict comparison, V5, V15, V17 and the V18 styles.

## Expressions

- **V1 — one expression language.** Every expression position (text,
  attribute values, props, marker arguments, every condition header, `{#for}`
  collections and range bounds, PuzzleKit `@event` arguments; Sites adds
  `{#let}`) parses as one D176 expression by one parser
  (`packages/puzzle-lang/expr`), which PuzzleKit lowers to JS and Sites will
  evaluate in Go. A display transform is a function call —
  `{ currency(price) }`, `{ t('cart.items', { count: items.length }) }` — and
  works in every position, headers included. A `|` is a positioned error
  (`` `| name` pipes were removed — write `name(value)`; bitwise OR is not
  available ``). `{#unless c}` is stored as `Unary !` over the condition.
- **V2 — `==`/`!=` are JavaScript loose equality** (`IsLooselyEqual`) in both
  hosts. No compiler warning; strict-equality teams use an optional
  `eqeqeq`-style `puzzle-eslint` rule.
- **V3 — absence.** `x == null` is the portable absence test; what
  `x === null` / `x === undefined` returns is host-defined (PuzzleKit follows
  JS). `??` is the fallback operator (`{ count ?? 'none' }` still prints `0`);
  docs steer away from `||`.
- **V4 — access through a missing value yields a missing value.** PuzzleKit
  codegen guards every member step, index step and method call
  (`a?.b?.c`, `a?.[i]`, `a?.trim()`), handler arguments included; a
  handler's free `event` chain is the DOM event and is written as authored.
  `Object.keys/values/entries` of a missing value return `[]` (render target
  lowers the argument to `<arg> ?? {}`; `puzzle check` keeps the author's
  spelling). The dev warning for an undefined interpolation stays; a method
  call on a missing receiver draws none (it would need a production helper).
- **V5 — arithmetic on non-numbers: host-specific.** Core: `+ - * / %`,
  unary `-`, `< <= > >=` on numbers; `+` with a string concatenates; strings
  order with strings; a Date orders and subtracts to milliseconds. Any other
  mix is host-defined (PuzzleKit: JS coercion; Sites: missing value + warning).
  There are no arithmetic functions (D174).
- **V7 — text units are JavaScript's.** `.length` counts UTF-16 code units;
  D176's string methods keep their JS meaning (Sites must index by UTF-16
  unit, use JS full case mapping and JS whitespace). `.size` is an ordinary
  member read. `truncate` (D174) counts code points and never splits a
  character, so it and `.length` disagree on non-BMP text by design.
- **V8 — object literals are core values**: name keys, quoted keys,
  shorthand. Computed keys, spread, methods, getters, numeric keys and the
  keys `__proto__`/`constructor`/`prototype` are positioned errors. An
  expression position cannot *start* with one (`{ {` reads as a doubled
  brace); the error says to pass it as a function argument or build it in
  `data()`. PuzzleKit lowers values only and expands shorthand — never scope
  the keys.

## Rendering

- **V6 — one printing rule** (`client-runtime/display.js` `displayValue`,
  shared by text, quoted attributes and the SSG serializer). Missing prints
  nothing (`undefined` warns once in dev; `null` is silent). Booleans print
  `true`/`false`. Numbers print by Number::toString; `NaN`/±Infinity print
  nothing. A list prints items by this rule joined with `,`. **Every object
  prints nothing** with a dev warning, whatever `toString` it defines (Date,
  URL, Decimal, Temporal, app classes) — format it or print a field. A Date
  gets its own dev warning naming `date()`/`datetime()`/`time()`; the
  `instanceof Date` check lives only inside the `__PUZZLE_DEV__` block. A
  function or symbol is not treated as an object and prints as `String()`
  would (guarding it would cost bytes on every interpolation).
- **V9 — a list in a brace-only attribute is a token list**: items print by
  V6, join with single spaces, and `false` plus every item that prints
  nothing is dropped (`class={ [active && 'on', 'btn'] }` → `class="btn"`).
  An object omits the attribute with a dev warning (`setAttr` and
  `serializeAttrs` must agree). Text interpolation keeps V6's comma join; a
  list passed as a prop stays a list.
- **V10 — whitespace**: the merged rule, owned by
  [[DECISION-D168-TEXT-RUN-WHITESPACE]].
- **V11 — text inside `{#raw}`** follows the core text rule and is not
  entity-decoded; `&`, `<`, `>` are escaped except inside
  `<script>`/`<style>`. Markup inside stays markup.

## Components, slots, loops

- **V12 — loop domain.** `{#for x in c}` iterates lists; the collection is any
  expression (`{#for t in todos.filter(t => !t.done)}`). Missing → zero
  iterations, silently; any other non-list → zero iterations with a dev
  warning. Range bounds truncate toward zero (dev warning if not an
  integer); a missing bound runs zero times. Index: `{#for item in items, i}`
  (0-based); `{#for 1...n, x}` binds the number. No `loop.first`/`loop.last`
  helpers — compare the index. PuzzleKit: codegen loop guard + `listRows`.
- **V13 — at most one default marker (`<Children/>` or bare `<Slot/>`), and
  one `<Slot name="x">` per name, per render path.** Markers in mutually
  exclusive `{#if}`/`{:else}`/`{#case}` branches are legal. Checked in the
  shared parser (`walkBranches` in `packages/puzzle-lang/parser/slot.go`).
- **V14 — a slot is filled when its content renders at least one node that is
  not whitespace-only text.** A call-site `{#if}` that renders nothing or a
  `{#for}` over an empty list leaves it unfilled, so the
  [[DECISION-D141-MARKER-FALLBACK-BODIES]] fallback shows (free empty
  states). Applies per snippet stamp too. A D180 `<Component>` range counts its rendered children, not its comment anchors, so an empty selection remains unfilled. PuzzleKit tests only when the
  marker has a fallback (`fill()` in `viewManager.js`); without one it
  splices the supplied nodes through, placeholders included, so arity stays
  constant (pinned by `tests/slot-filled.test.js`). **Gotcha:** a fallback
  whose node count differs from the content's still shifts following
  siblings on each flip; authors keep such a fallback to one root element
  (SPEC §24, D141, SKILL.md). Padding to fix it was rejected (+32 B gzip).
- **V15 — props into scope: host-specific**, plus a script-less PuzzleKit
  component gets a synthesized `data(params, props)` returning its props, so
  `{ tone }` reads the prop as in Sites. With a script, `data()` decides.
- **V16 — dotted tags are a Sites restriction for now.** The shared parser
  accepts `<Frame.Wrapper>`; Sites rejects it with a positioned error.
  PuzzleKit families ([[DECISION-D167-COMPONENT-FAMILIES]]) are unaffected.

## Host-specific

- **V17 — function failure policy.** Each host decides unknown names, wrong
  arity and out-of-domain input. PuzzleKit passes the value through and logs
  a dev error (naming the replacement for a removed name), because app
  functions register at runtime out of the compiler's sight; `puzzle check`
  types standard-function arguments, and an unknown string-literal date
  preset or time zone is a positioned build *warning* (an app may register
  its own function under that name). Sites fails the compile or warns.
- **V18 — scoped styles are host-specific** (shared stamping algorithm,
  host-defined attribute prefix and target). **`{#svg}` paths** are relative
  to the host's assets root in both; an explicit `assets/` prefix is a Sites
  compile error.

## Where it lives (PuzzleKit)

V1/V4/V8: `packages/puzzle-lang/expr` + `compiler/internal/codegen/lower.go`.
V6/V9: `client-runtime/display.js`, `setAttr`, `client-runtime/ssg/serialize.js`.
V10: `codegen.go` (D168). V12: codegen loop guard + `client-runtime/views/listBlock.js`.
V13: `puzzle-lang/parser/slot.go`. V14: `viewManager.js` `fill()`. V15: codegen.
Grammar changes (V1, V13) must reach the vendored ports in `puzzle-eslint` /
`puzzle-prettier` and the three editor grammars. Shared conformance fixtures
(`packages/puzzle-lang/conformance`) are the proof a unified item matches in
both hosts.

## Sites, pending

Evaluator: D176 grammar + D174 library in Go, loose equality (V2), UTF-16
`.length` and JS-exact string methods (V7), printing (V6), `Object.*`
default (V4). Renderer: whitespace (V10), raw escaping (V11), loop bounds
(V12), filled rule (V14), `{#svg}` prefix error (V18), dotted-tag error
(V16). Flag it if Sites treats a Date as a printable scalar (V6).

## Alternatives rejected

- **`==` means `===`, or reject `==`** — redefines or forbids valid JS; the
  optional lint rule covers strict teams.
- **Lower `=== null` to `== null`** — changes a valid JS result.
- **Mandatory `?.`** — keeps a crash for anyone who forgets it.
- **Unify V5 via runtime helpers** — cost on the hottest path for inputs no
  correct template produces.
- **Code points in Sites, UTF-16 in PuzzleKit** — the hosts would disagree.
- **One host's whitespace rule wholesale** — see D168.
- **Static slot-filled rule** (any non-whitespace authored content fills) —
  no empty-state behavior.
- **Map dotted tags to Sites files now** — Sites has no need yet; lifting the
  restriction later is an addition.
- **Leave everything host-defined** — contradicts D172.
