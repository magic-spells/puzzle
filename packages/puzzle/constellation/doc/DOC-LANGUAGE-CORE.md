---
name: >-
  The Puzzle language core — the constructs every host shares, the expression grammar, and the two
  dialects
kind: reference
status: built
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DECISION-D173-CORE-SEMANTICS
  - DECISION-D174-STANDARD-FORMATTERS
  - DECISION-D175-TRANSLATIONS
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DECISION-D166-SNIPPETS
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-SPEC-ANATOMY
  - COMPONENT-FORMATTERS
  - COMPONENT-TEMPLATE-PARSER
---

# The Puzzle language core

The source for the Language section on puzzlejs.dev, written for a reader who knows HTML. It owns the **expression grammar** (the Expressions section below is normative for [[DOC-SPEC-TEMPLATE]] §6) and the map of what is core versus dialect. Every other construct has its full contract in a `§N` of [[DOC-SPEC-TEMPLATE]]; this card states the rule and links it.

## What Puzzle is

Puzzle is **one template language with two dialects**. A `.pzl` file is HTML plus a few brace constructs (`{ … }`, `{#if}`, `{#for}`, …) and tags HTML lacks (`<Children/>`, `<Slot>`, components). That shared part is the **core**. Each host is a **dialect**:

- **PuzzleKit**, the app framework in this package, compiles `.pzl` to JavaScript that renders in the browser.
- **Magic Spells Sites** renders themes on the server: it parses with the same module and evaluates the tree in Go.

One parser, `packages/puzzle-lang` (`parser` + `expr`), reads both; each host turns switches on or off (`parser.Options`: `Let`, `Pipes`, the island/slot/ref checks, `MaxDepth`). The zero `Options` is PuzzleKit's grammar.

The rule that holds them together: **a dialect may add constructs or restrict the core, but never gives shared syntax a different meaning.** A proposal needing one spelling to behave differently per host gets a new spelling. Rationale and naming: [[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]].

## Markup and text

- **`{` starts template syntax** everywhere in text, including the body of a `<script>`/`<style>` element written inside a template. `\{` and `\}` are literal braces (text, quoted attribute values, `{## }` comments); a lone `}` in text is literal; `{#raw}` makes a whole body literal.
- **`<` followed by a letter or `_` opens a tag**, in any script (`a<b` and `値<上限` in text are errors); `<` before a space, digit or `$` is text.
- **Void elements** (`area base br col embed hr img input link meta source track wbr`, lowercase only) take no closing tag; `</input>` is an error. §6.
- **Text is not entity-decoded**: `&amp;` displays as `&amp;`. HTML comments are removed at compile time.
- **Whitespace** renders as the browser renders the same markup, minus source indentation: newline-bearing whitespace between two tags or at a parent's edge disappears; between text and anything else it is one space; `<pre>`/`<textarea>` keep their bytes. §6, [[DECISION-D168-TEXT-RUN-WHITESPACE]].

## Interpolation and functions

`{ expression }` writes a value into text or an attribute, printed by one rule ([[DECISION-D173-CORE-SEMANTICS]] V6, §6): `null`/`undefined` print nothing, numbers print as JavaScript prints them (`NaN`/Infinity print nothing), booleans print `true`/`false`, a list prints its items joined with `,`, and any other object prints nothing (a host may warn).

A **function** presents a value, called the JavaScript way with the value first ([[DECISION-D176-EXPRESSION-LANGUAGE]] rule 4):

```html
<p>{ truncate(post.body, 120) }</p>
<p>{ currency(price * (1 - discount)) }</p>
<a title={ currency(price) }>…</a>
```

- A call is an ordinary expression, so it goes wherever a value goes; calls nest.
- A standard function never duplicates an operator, a method or a `Math` global: a count is `.length`, arithmetic is the operators and `Math.*`, a fallback is `??`, a string or list transform is a method.
- A bare call resolves to the function library and a bare name to data, so the two never shadow each other.
- `raw` and `newline_to_br` return markup, so each may only be the outermost call of a text interpolation ([[DECISION-D174-STANDARD-FORMATTERS]]).
- A function should be pure.

## Attributes

| Form | Example | Meaning |
|---|---|---|
| static | `class="card"` | copied as written |
| valueless | `hidden` | present, empty |
| quoted with interpolation | `class="card { tone }"` | one assembled string |
| inline branch | `class="btn {#if active}is-active{/if}"` | flat `{#if}…{:else}…{/if}` only |
| brace-only | `disabled={ isLocked }` | the value itself |

A brace-only value controls presence (V9, §6): `false`/`null`/`undefined` omit the attribute, `true` writes it empty, a list is a space-joined token list with `false` and empty items dropped (`class={ [active && 'on', 'btn'] }` → `class="btn"`), an object omits it. A quoted value is text, so a missing value writes it empty. An attribute name containing `:` is reserved, except the `xml`, `xlink` and `xmlns` namespaces. Each dialect reserves more names (PuzzleKit: `@event`, `ref`, `key`, `flip`, `island`).

## Control blocks

```html
{#if items.length > 3}<p>many</p>{:else if items.length > 0}<p>a few</p>{:else}<p>none</p>{/if}

{#unless user}<a href="/login">Sign in</a>{:else}<span>{ user.name }</span>{/unless}

{#case order.status}
  {:when 'paid', 'shipped'}<span>On its way</span>
  {:else}<span>Pending</span>
{/case}

{#for t in todos.filter(t => !t.done), i}<li>{ i }: { t.text }</li>{/for}
{#for 1...3, n}<li>Step { n }</li>{/for}
```

- `{#if}` takes any number of `{:else if}` and one final `{:else}`; `{#unless}` allows `{:else}` only. `{#case}` compares with `===`, a `{:when}` lists alternatives with commas, the first match wins, no fall-through. Conditions and subjects are single expressions. §6.
- `{#for item in items[, i]}` binds the item and optionally its 0-based index; `{#for a...b[, x]}` runs each whole number from `a` to `b` inclusive. `{#for i in 1...5}` is an error steering to `{#for 1...5, i}`. A missing collection runs zero times; any other non-list runs zero times with a development warning; range bounds truncate toward zero (V12). §6. PuzzleKit's row keying and caching (§28) is dialect behavior.

## Raw, SVG and comments

- **`{#raw}…{/raw}`** makes every brace in its body literal while HTML inside stays HTML; no nesting, not inside attribute values. §57.
- **`{#svg 'path'}`** inlines an SVG file at compile time, no closer; the path is static and relative to the host's assets folder (PuzzleKit `app/assets/`, Sites the theme's `assets/`); nothing in the file is interpolated. §18.
- **`{## text }`** and **`{#comment}…{/comment}`** are removed at compile time; a block comment's body may be broken template code. §6.

## Components

A tag whose name does **not** start with a lowercase ASCII letter is a component, so `<UserCard>`, `<Übersicht>`, `<概要>` and `<_row>` are components and `<straße-karte>` is a custom element:

```html
<UserCard user={ author } size="small" />
<Frame><Frame.Wrapper>…</Frame.Wrapper></Frame>
```

- The name is `Ident('.'Ident)*` of `$`-free JavaScript identifiers in any script; the dotted form is a **component family** member. §65, [[DECISION-D167-COMPONENT-FAMILIES]].
- **Props are attributes**: static → a string, brace-only → the value (a list stays a list), quoted with interpolation → the assembled string. Prop names may use any script.
- `Children`, `Slot`, `Snippet`, `Portal` and `Component` are reserved tag names (and cannot root a dotted name).
- How a name finds its file and how a component reads props is host-defined (D173 V15): PuzzleKit resolves `<script>` imports and passes props to `data(params, props)`, and a script-less component's `data()` returns its props; Sites resolves `components/<Name>.pzl` and exposes props as bare names.

## Slots

A slot is a placeholder filled from outside the file (§24, [[DECISION-D141-MARKER-FALLBACK-BODIES]]):

```html
<!-- Card.pzl -->
<article class="card">
  <header><Slot name="header"/></header>
  <div class="body"><Children/></div>
  <footer><Slot name="footer">No footer yet</Slot></footer>
</article>

<!-- a call site -->
<Card>
  <h2 slot="header">{ post.title }</h2>
  <p>{ post.excerpt }</p>
</Card>
```

- `<Children/>` receives the untagged children; `<Slot name="x"/>` receives children marked `slot="x"` (`default` and `children` are reserved names).
- A marker is self-closing or paired; a paired body is the fallback, shown only when nothing fills the position. **Filled means it rendered a non-whitespace node** (V14), so an empty `{#for}` or a false `{#if}` shows the fallback.
- **One marker per render path** (V13): exclusive `{#if}`/`{#case}` branches are separate paths, so each may hold its own `<Children/>`; a marker in a `{#for}` body is one declaration.
- In a layout, the plain `<Slot/>` is the page (PuzzleKit: the routed view; Sites: the page template and sections). A host may reserve named layout slots (Sites: `head-content`, `header-group`, `footer-group`, `panel-group`).
- `<Children/>` inside another component's call site forwards this file's default content ([[DECISION-D71-SLOT-FORWARDING]]). Lowercase `<slot>`/`<children>` are errors.

## Snippets

A **snippet** is a template the caller hands a component that owns a loop; the component stamps it per item with values passed through its own marker (§64, [[DECISION-D166-SNIPPETS]]):

```html
<UserList users={ users }>
  <Snippet user><b>{ user.name }</b></Snippet>
</UserList>

<!-- UserList.pzl -->
<ul>{#for user in users}<li><Children user={ user }>{ user.name }</Children></li>{/for}</ul>
```

`<Snippet>` is paired and a direct child of a component call; `fits="x"` targets `<Slot name="x">`; every other attribute is a bare parameter, matched by name to the marker's valued attributes; the body is a composition leaf. The parser accepts it for every host; Sites rejects it.

## Expressions

A template expression is **JavaScript's expression syntax, closed by one grammar and a method table** ([[DECISION-D176-EXPRESSION-LANGUAGE]]). One parser (`packages/puzzle-lang/expr`) reads every expression into a tree both hosts consume — PuzzleKit lowers it to JavaScript, Sites evaluates it in Go — so anything outside the grammar is a positioned compile error in both, at the same position, naming the construct and what to write instead. Every position takes the same grammar: text, attribute values, props, marker arguments, conditions, `{:when}` values, `{#for}` headers and PuzzleKit's `@event` handler arguments. The shared table `packages/puzzle-lang/conformance/expressions-parse.json` pins it.

**A template expression never reaches the view instance.** A displayed value comes through `data()` (PuzzleKit) or the render context (Sites); logic that outgrows an expression is computed first — a `data()` field in PuzzleKit, a `{#let}` in Sites.

**Names.** An identifier reads the host's scope (PuzzleKit `data()` fields and props; Sites the render context and props) plus template bindings: `{#for}` items and counters, `<Snippet>` parameters, arrow parameters (and Sites `{#let}` names). Identifiers follow JavaScript's `ID_Start`/`ID_Continue` (`{ größe }`). Reserved words are errors except `eval` and `arguments`; `__proto__`, `constructor` and `prototype` are errors as member names and object keys. A bound name is a value (calling one is an error).

- **`this` is not a name** anywhere, handler arguments included: "`this` is not available in template expressions — return the value from data() (a getter or a computed field), or use a function for a display transform". `x.this` is an ordinary member read.
- **`window`, `document`, `globalThis`** as a data root are errors ("`window` is the browser window, which template expressions cannot reach — read the value you need in data() and return it"); a binding or parameter with one of those names is fine. Every other name, `location` and `localStorage` included, reads data.
- `event` is an ordinary name except inside a PuzzleKit handler (§5).

**Literals.**

| Kind | Examples |
|---|---|
| number | `12`, `1.25`, `.5`, `1e3` — decimal only; hex, octal, binary, BigInt, `1_000` and a leading zero are errors |
| string | `'quiet'`, `"quiet"` with strict-mode escapes (`\n`, `\xHH`, `\u{…}`); a raw line break, a legacy octal escape or a lone surrogate escape is an error |
| template literal | `` `${first} ${last}` `` |
| boolean, absent | `true`, `false`, `null`, `undefined` |
| number constants | `NaN`, `Infinity` |
| list | `[]`, `[price, qty]` |
| object | `{ height: 480 }`, `{ 'cart.count': n }`, `{ count }` — never at the start of an expression |

**Object literals** (D173 V8) take identifier keys, quoted keys and shorthand; computed keys, spread, methods and numeric keys are errors. `{ {` reads as a doubled brace, so an object goes in an argument: `{ t('cart.items', { count: items.length }) }`.

**Access.** `a.b`, `a?.b`, `a[expr]`, `a?.[expr]`. **Reading a member of, or calling a method on, a missing value yields a missing value** (D173 V4), which prints nothing; `?.` is legal and unnecessary. `Object.keys`/`values`/`entries` of a missing value are `[]`. `.size` is not special — it reads a field named `size`.

**Calls.** Three kinds; nothing else is callable:

- **A function** `name(args)` — resolves to the function library, never data (`{ currency(price) }`, `{ date(post.createdAt, 'long') }`, an app's `{ specialFormat(x) }`).
- **A method** `value.m(args)` / `value?.m(args)` from the table (`expr/methods.go`):

  | Receiver | Methods |
  |---|---|
  | string | `length` (property, UTF-16 units), `at`, `charAt`, `includes`, `startsWith`, `endsWith`, `indexOf`, `lastIndexOf`, `slice`, `substring`, `split`, `replace` (first occurrence), `replaceAll`, `trim`, `trimStart`, `trimEnd`, `toUpperCase`, `toLowerCase`, `padStart`, `padEnd`, `repeat`, `concat` |
  | list | `length` (property), `at`, `includes`, `indexOf`, `lastIndexOf`, `slice`, `concat`, `join`, `flat`, `find`, `findIndex`, `findLast`, `filter`, `map`, `some`, `every`, `reduce`, `toSorted`, `toReversed` |
  | number | `toFixed`, `toString` (no radix) |
  | boolean, `null`, `undefined`, record, object | none — read fields, or iterate with `Object.keys`/`values`/`entries` |

  Each means what it means in JavaScript and none mutates (no `push`, `sort`, `reverse`, `splice`). A name outside the table is an error naming the alternative (`sort` → `toSorted()`, `push` → `concat()`, `substr` → `slice()`, `getFullYear` → `date(v, preset)`); `.length()` is an error. When the syntax fixes the receiver's type (a literal, a template literal, `Math.PI`, `Number(x)`), the method is checked against it at parse time (`'s'.filter(f)` is an error); on a data path the name only has to be in the table — `puzzle check` types it in PuzzleKit.
- **A global** from a fixed list: `Math.abs`, `ceil`, `floor`, `round`, `trunc`, `max`, `min`, `sign`, `pow`, `sqrt`, `Math.PI`, `Math.E`; `Number`, `String`, `Boolean`; `Array.isArray`; `Object.keys`, `values`, `entries`; `parseInt`, `parseFloat`, `isNaN`, `isFinite`; `encodeURIComponent`, `decodeURIComponent`, `encodeURI`, `decodeURI`. No `Date`, `JSON`, `Intl`, `Map`, `Set` or `fetch` (dates and JSON display through `date()` and `json()`). A global is only ever called: `items.filter(Boolean)` is an error that says `x => Boolean(x)`.

A computed method call (`a[name]()`), calling a call's result (`f(x)(y)`) and an optional call (`f?.(x)`) are errors.

**Arrow functions** appear only as call arguments, with an expression body and plain parameters: `todos.filter(t => !t.done)`, `rows.toSorted((a, b) => a.rank - b.rank)`. A callback receives `(item, index)`; an object body is `x => ({ … })`; defaults, rest and destructuring are errors.

**Operators**, loosest first:

| Operator | Meaning |
|---|---|
| `c ? a : b` | ternary; only the chosen branch evaluates |
| `a \| f` | pipe — only with `Options.Pipes` (Sites); see below |
| `a ?? b` | `b` when `a` is `null`/`undefined` (`0`, `''`, `false` kept) |
| `a \|\| b`, `a && b` | return an operand, not a boolean |
| `==` `!=` | JavaScript loose equality (V2) |
| `===` `!==` | strict; lists and objects compare by identity |
| `<` `<=` `>` `>=` | number with number, string with string |
| `+` `-` | numbers; `+` concatenates when either side is a string |
| `*` `/` `%` | numbers |
| `!x` `-x` `+x` | prefix; `!x` is boolean, `+x` a number |
| `.` `?.` `[…]` `(…)` | postfix, tightest |

- **Test absence with `x == null`** (V3) — true for both absent values.
- **A fallback is `??`, never `||`**: `{ count ?? 'none' }` still prints `0`.
- **`??` cannot mix with `&&`/`||` without parentheses** (the error offers `(a ?? b) || c` and `a ?? (b || c)`).
- **Truthiness:** `false`, `0`, `NaN`, `''`, `null`, `undefined` are falsy; an empty list or object is truthy — test `items.length > 0`.
- **Math is the operators and `Math.*`**, then a function to present it: `{ round(total / count, 1) }` (`round` takes places; `Math.round` does not).
- **A date value** takes only `<`, `<=`, `>`, `>=` and binary `-` (as milliseconds), has no methods, and cannot be constructed; display it with `date()`, `time()`, `datetime()` or `timeago()`.
- **Division:** with no regex literals, `/` after any operand divides (`{ café / 2 }`, `{ 金額 / 2 }`, `{ 5. / 2 }`, a field named `of`), and a regex-shaped expression is the grammar's error at the `/`, never "unclosed `{`".

**Pipes (`expr.Options.Pipes`, D176 §4).** Off — PuzzleKit — a `|` is the error "`| name` pipes are Sites theme syntax — in a Puzzle app write `name(value)`"; when the name is a removed formatter the message names its JavaScript replacement instead (`| upcase` → `value.toUpperCase()`, from `expr.RemovedFormatters`). On — Sites — `x | f` and `x | f(a, b)` are parse-time sugar for `f(x)` and `f(x, a, b)`: the tree holds the same `Call` node the written call produces, so no evaluator or code generator sees a pipe. A pipe binds looser than every binary and logical operator and tighter than `?:` (`price * qty | currency` is `currency(price * qty)`); chains apply left to right; every expression position takes one. The name after `|` is a plain function name — JavaScript's statement words included, so `x | default(0)` is `default(x, 0)`; a member, a namespace, a literal or an operator keyword is "expected a function name after `|`".

**Attribute spread is separate syntax ([[DECISION-D180-COMPONENT-SLOT]]):** `{...props}` on a component invocation is an attribute with one ordinary expression operand. It merges props in written order, except a PuzzleKit loop row's resolved key wins over spread keys (§28); it does not make `[...items]` or `{ ...props }` legal expressions. The `<Component>` `is` attribute alone may read script module bindings directly; other expressions keep data scope.

**Not in the language** (a compile error in both hosts): bitwise operators, `**` (`Math.pow`), `in`, `instanceof`, `typeof`, `void`, `delete`, `new`, the comma operator, assignment, `++`/`--`, regular expressions, comments, statements, `function`, classes, `await`/`yield`, tagged templates and spread. Arithmetic or comparison on mixed or non-number types is host-defined (V5).

**Handlers (PuzzleKit only)** are the one door into the view's JavaScript: a handler name, one call to it, a conditional of those or `null`, or `null`; arguments are ordinary expressions evaluated at fire time, and a chain rooted at the free `event` is the DOM event and skips the method table. §5. Sites rejects `@event`.

## Dialects

| | PuzzleKit | Sites |
|---|---|---|
| File structure | `<puzzle-view>` root (§3); optional `<puzzle-skeleton>` (§16), `<script>` class (§4, `lang="ts"` §25), `<style>`/`<style scoped>` (§29) | No wrapper; the directory decides the file kind; optional `<schema>` and a browser `<script>` (not in components); **no `<style>`** — a theme is styled with Tailwind and its `styles/theme.css`. Parsed with `parser.ParseMarkup` |
| Parser switches | the zero `Options` | `Let`, `Pipes`; island/slot/ref checks skipped (Sites runs its own) |
| Expressions | the whole grammar, lowered to JavaScript, plus the `@event` handler | the same tree with pipes on, evaluated in Go with JavaScript's semantics; **no methods** (each refused with a steer to the pipe to write) and **no arrow functions**; globals are only `parseInt`, `parseFloat`, `encodeURIComponent`, `Math.min`, `Math.max`, `Math.PI`, `Math.E` |
| Naming a computed value | a `data()` field (no `{#let}`) | `{#let}` |
| Adds | `<Component>` runtime selection (§67); `@event` + modifiers (§5, §47); callback props; implicit two-way binding ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]); `<Portal>` ([[DECISION-D144-PORTAL]]); `island` (§17); `key` (§28); `ref` (§38); `flip` (§46); `link`, `timeago` and app-registered functions | `{#let}`; pipes; display-transform functions in place of methods (`upcase`, `downcase`, `strip`, `split`, `replace`, `join`, `slice`, `contains`, `first`, `last`, `reverse`, `compact`, `uniq`, `sort`, `where`, `reject`, `find`, `map`, `default`, `abs`, `ceil`, `floor`); platform functions (`url`, `asset_url`, `menu_link`, `image_url`, `image_srcset`, `image_tag`, `class_map`, `sum`, `size`); `<Form>`; reserved layout slots and section groups |
| Restricts | — | `@event`, `<Portal>` and `<Snippet>` are errors; `ref`/`key`/`flip`/`island` dropped with a warning; an unknown function or wrong argument count is a compile error; a `<style>` is an error |

So a template does not move between hosts unchanged: PuzzleKit writes `name.toUpperCase()` and `currency(price)`, Sites writes `name | upcase` and `price | currency`. Sites's own record of the split is its `engine/docs/template-language.md` ("Sites and Puzzle") and its `DECISION-EXPRESSION-SUBSET` / `DECISION-SITES-TEMPLATE-ALLOWLIST` cards.

## Section map

Which SPEC sections are core and which PuzzleKit. A **core** section can still carry PuzzleKit-only detail; the note names it.

| § | Section | Layer | PuzzleKit-only parts |
|---|---|---|---|
| 5 | Event handler convention | PuzzleKit | |
| 6 | Template grammar | mixed | value printing, expressions (D176), function call syntax and the standard library, conditionals, loops, attribute values, dynamic attributes, components, layout slot, comments, raw blocks are core; the undefined-value warning, the handler door, the purity contract, the unknown-name guard, app functions, `link`, `timeago`, calendar dates, auto-keying, implicit two-way binding, callback props, islands and refs are PuzzleKit |
| 17 | DOM islands | PuzzleKit | |
| 18 | `{#svg}` | core | `app/assets/`, dev watch, `pzlc --assets` |
| 24 | Composition markers | core | "the router fills the default slot" |
| 28 | List keying | PuzzleKit | |
| 31 | Cached event handlers | PuzzleKit | |
| 43 | Accessibility warnings | PuzzleKit | |
| 47 | `@event:outside` | PuzzleKit | |
| 57 | `{#raw}` | core | the prerender escaping paragraph |
| 64 | Snippets | core grammar | the whole runtime (Sites rejects `<Snippet>`) |
| 65 | Component families | core (tag-name grammar) | the barrel, lexical resolution, `generate component --family` |
| 66 | Translations | core `t` | the service, `setLocale`, loading |
| 67 | Runtime component selection | PuzzleKit | |

[[DOC-SPEC-ANATOMY]] §3, §4, §10, §11, §25, §29 and §40 are PuzzleKit, as are DOC-SPEC-VIEW §12, §16, §38 and §46.

## Standard functions

[[DECISION-D174-STANDARD-FORMATTERS]] fixes the **standard library: 19 functions** with the same arguments and meaning in both hosts: `round`, `currency`, `percentage`, `number_with_delimiter`, `compact_number`, `pluralize`, `capitalize`, `truncate`, `strip_html`, `strip_newlines`, `escape`, `raw`, `newline_to_br`, `json`, `date`, `time`, `datetime`, `in_timezone`, and `t` ([[DECISION-D175-TRANSLATIONS]]). `packages/puzzle-lang/conformance/functions.json`, embedded by the language module's `conformance` package, pins the identical-output rows and the locale-independent rows of the rest; both hosts run it.

- **PuzzleKit** ([[COMPONENT-FORMATTERS]]): `client-runtime/formatters/builtins.js` is the standard set without `t`, plus `timeago`; the registry adds the router-backed `link`, and the i18n service adds `t` when translations are configured (21 names). An app may register its own.
- **Sites** implements all 19 in Go, plus its display transforms and platform functions; the library is fixed (no theme-registered functions) and has no `timeago` (a page's bytes must not depend on when it rendered) or `link` (Sites has `url`).
- Names PuzzleKit removed in favor of methods, operators and `??` (`upcase`, `join`, `plus`, `default`, `noescape`, …) steer to the replacement in PuzzleKit; several return in Sites as display transforms. That is a dialect addition, not a change of meaning.

## Host-specific by decision

[[DECISION-D173-CORE-SEMANTICS]] names the semantics both hosts must share; a host that differs is a bug in that host. These are host-defined on purpose:

- **V5 — non-number arithmetic/comparison** (`'2' * 3`, `null + 1`, `1 < '2'`). PuzzleKit follows JavaScript's coercion. Dates order and subtract as milliseconds in both.
- **V17 — function failure.** An unknown name or wrong argument count is a compile error in Sites. In PuzzleKit the value passes through with a development error (app functions register at runtime), `puzzle check` types the standard functions, and a literal unknown date preset or zone is a compile warning.
- **`{#svg}` paths:** Sites also accepts an explicit `assets/` prefix (PuzzleKit reads `{#svg 'assets/x.svg'}` as `app/assets/assets/x.svg`).
