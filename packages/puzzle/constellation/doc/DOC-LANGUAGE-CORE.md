---
name: >-
  The Puzzle language core — the constructs every host shares, the two dialects, and where they
  still diverge
kind: reference
status: built
connections:
  - DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-SPEC-ANATOMY
  - COMPONENT-FORMATTERS
  - COMPONENT-TEMPLATE-PARSER
  - DECISION-D166-SNIPPETS
---

# The Puzzle language core

This card is the source for the Language section on puzzlejs.dev. It is written
for a reader who knows HTML and has not seen Puzzle before.

## What Puzzle is

Puzzle is **one template language with two dialects**. A `.pzl` file is HTML
plus a small set of brace constructs (`{ … }`, `{#if}`, `{#for}`, …) and a few
tags HTML does not have (`<Children/>`, `<Slot>`, components). That shared part
is the **core**. Each host that runs Puzzle is a **dialect** of it:

- **PuzzleKit** — the app framework in this package. It compiles `.pzl` files to
  JavaScript that renders in the browser.
- **Magic Spells Sites** — server-rendered themes. It evaluates `.pzl` files in
  Go and sends HTML.

The rule that holds the dialects together: **a dialect may add constructs or
restrict the core, but it never gives shared syntax a different meaning.** A
proposal that would need one spelling to behave differently per host gets a new
spelling instead. The rationale, the naming ("Puzzle" in prose, "PuzzleKit" for
the app layer) and the parser architecture are in
[[DECISION-D172-ONE-LANGUAGE-TWO-DIALECTS]]. The places where today's two
implementations still break the rule are listed at the end of this card.

Where a construct already has a full contract in [[DOC-SPEC-TEMPLATE]], this
card states the rule and links the `§N`. It does not restate it.

## Markup and text

A `.pzl` template is ordinary HTML. Elements, attributes and text mean what
they mean in HTML, with these rules:

- **`{` starts template syntax** everywhere in text. Write `\{` and `\}` for
  literal braces, in text, in quoted attribute values, and inside `{## … }`
  comments. A lone `}` in text is literal. This includes the bodies of a
  `<script>` or `<style>` element written inside a template: `.a { color: red }`
  there is an interpolation, so escape the braces or wrap the body in `{#raw}`.
- **`<` followed by a letter or `_` opens a tag**, in any script: `a<b` and
  `値<上限` in text are compile errors. A `<` followed by a space, a digit or
  `$` is text (`a < b`, `<$50`).
- **Void elements take no closing tag**, as in HTML. The void elements are
  `area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`,
  `source`, `track` and `wbr`. Each one ends at its start tag: `<br>`, `<br/>`
  and `<br />` mean the same thing, `<input type="text">` needs no slash, and
  what follows a `<br>` belongs to the parent. A closing tag such as `</input>`
  or `</br>` is a positioned compile error that names the void element. Only
  the lowercase names are void: `<Input>` is a component.
- **Text is not entity-decoded.** Write the character you mean. `&amp;` in
  template text or in a static attribute value displays as the five characters
  `&amp;`, not as `&`.
- **HTML comments `<!-- … -->` are removed at compile time.** They never reach
  the output.
- **Whitespace** ([[DECISION-D168-TEXT-RUN-WHITESPACE]], §6): text renders the
  way the same markup renders in a browser, minus source indentation. A run of
  spaces, tabs and newlines collapses to one space. Whitespace that contains a
  newline is dropped at a parent's first or last child and between two
  non-text siblings (elements, components, markers, `{#svg}`, control blocks),
  so stacked buttons get no gap. Between text or an interpolation and anything
  else it is one space: `tokens —` + newline + `<code>a</code>,` + newline +
  `<code>b</code>` + newline + `and more` renders `tokens — a, b and more`, and
  `{ user.first }` and `{ user.last }` on two lines render `John Doe`. A space
  next to a control block sits outside the block, so it renders whether or not
  the branch does. `{ a }{ b }` with nothing between them stays adjacent. A
  `<pre>` or `<textarea>` body keeps its bytes exactly, except the one newline
  right after the start tag, which HTML drops too.

```html
<p>Price: \{ not an interpolation \}</p>
<label>Name <input type="text" name="name"></label>
```

## Interpolation and functions


`{ expression }` writes a value into text or an attribute. Every host prints a
value by one rule ([[DECISION-D173-CORE-SEMANTICS]] V6):

- `null` and `undefined` print nothing: an empty string, never a word.
- `true`/`false` print as `true`/`false`.
- Numbers print by JavaScript's Number::toString: the shortest decimal that
  round-trips, in exponent form at or above 1e21 and below 1e-6 (`1e+21`,
  `1e-7`). `NaN` and ±Infinity print nothing.
- A list prints its items by this same rule, joined with `,`.
- Any other object prints nothing, and a host may warn in development (PuzzleKit
  does). Format the value or print one of its fields.

A **function** presents a value for display. Call it the way JavaScript calls
a function, with the value as the first argument
([[DECISION-D176-EXPRESSION-LANGUAGE]] rule 4):

```html
<p>{ post.title.toUpperCase() }</p>
<p>{ truncate(post.body, 120) }</p>
<p>{ capitalize(product.name.trim()) }</p>
<p>{ currency(price * (1 - discount)) }</p>
<a title={ currency(price) }>…</a>
```

- A call is an ordinary expression, so it goes wherever a value goes: text,
  attribute values, props, marker arguments, conditions and `{#for}` headers.
  Arguments are expressions separated by commas, and an object literal is one:
  `{ t('cart.count', { count: n }) }`. Calls nest: `{ b(a(x)) }`.
- **There is no pipe.** A `|` anywhere in an expression is a positioned
  compile error in both hosts: "`| name` pipes were removed — write
  `name(value)`; bitwise OR is not available". When the name after the `|` is
  one the library dropped, the message names its JavaScript replacement
  instead (`| upcase` → `.toUpperCase()`). `||` is logical OR.
- **A function never duplicates an operator, a method or a `Math` global**
  (D176). A count is `.length`, arithmetic is `+ - * / %` and `Math.*`, a
  fallback is `??`, and a string or list transform is a method from the table
  (see Expressions): `{ items.length }`, `{ percentage(ratio * 100) }`,
  `{ name ?? 'Anonymous' }`, `{ tags.join(', ') }`.
- A bare call resolves to the function library and a bare name to data, so a
  data field is never callable and never shadows a function.
- `raw` and `newline_to_br` return markup, so each may only be the outermost
  call of a text interpolation, with one argument: `{ raw(post.body) }`
  ([[DECISION-D174-STANDARD-FORMATTERS]]).
- A function should be a pure function of its input.

Which functions exist beyond the standard library is a host decision; the names
both hosts implement identically are the **standard library** (see Standard
functions below). Full PuzzleKit contract: §6 and [[COMPONENT-FORMATTERS]].

## Attributes

| Form | Example | Meaning |
|---|---|---|
| static | `class="card"` | copied as written |
| valueless | `hidden` | present, empty |
| quoted with interpolation | `class="card { tone }"` | text and values assembled into one string |
| inline branch | `class="btn {#if active}is-active{/if}"` | `{#if}…{:else}…{/if}` inside a quoted value; `{:else if}` is not allowed here |
| brace-only | `disabled={ isLocked }` | the expression's value, not a string |

A brace-only value controls the attribute's presence
([[DECISION-D173-CORE-SEMANTICS]] V9):

- `false`, `null` and `undefined` omit the attribute; `true` writes it with an
  empty value.
- A list is a token list: its items, each printed by the value rule above, are
  joined with single spaces, and `false` and every item that prints nothing
  (`null`, `undefined`, `''`, …) are dropped. So the clsx idiom
  `class={ [active && 'on', 'btn'] }` writes `class="btn"`. (Text and quoted
  attributes keep the plain `,` join, and a list passed to a component as a
  prop stays a list.)
- An object omits the attribute, and a host may warn in development.
- Anything else is printed by the value rule.

A quoted value is text: `title="{ x }"` with a missing `x` writes an empty
attribute rather than omitting it. An attribute name containing `:` is
reserved, except the `xml`, `xlink` and `xmlns` namespaces.

Each dialect reserves its own attribute names on top of this (PuzzleKit:
`@event`, `ref`, `key`, `flip`, `island`; see the dialect table).

## Control blocks


```html
{#if items.length > 3}
  <p>many</p>
{:else if items.length > 0}
  <p>a few</p>
{:else}
  <p>none</p>
{/if}

{#unless user}<a href="/login">Sign in</a>{:else}<span>{ user.name }</span>{/unless}

{#case order.status}
  {:when 'paid', 'shipped'}<span>On its way</span>
  {:when 'refunded'}<span>Refunded</span>
  {:else}<span>Pending</span>
{/case}
```

- **`{#if}`** takes any number of `{:else if cond}` clauses and one optional
  trailing `{:else}`. `{#unless}` is the inverted form; it allows `{:else}` but
  not `{:else if}`. Each condition is one expression, calls and methods
  included: `{#if tags.length > 0}`, `{#if post.title.startsWith('Draft')}`.
  §6.
- **`{#case expr}`** compares with strict equality. The subject and the
  `{:when}` values are expressions. A `{:when}` may list
  several values, separated by commas, as alternatives. The first match wins and
  there is no fall-through. Only whitespace may appear before the first
  `{:when}`, and `{:else}` must be last. §6.
- **`{#for}`** has four forms:

  | Form | Binds |
  |---|---|
  | `{#for item in items}` | each item |
  | `{#for item in items, i}` | each item and its 0-based index |
  | `{#for 1...n}` | nothing; runs for each whole number from 1 to n, inclusive |
  | `{#for 1...n, x}` | the current number |

  Both range bounds are expressions (`{#for start...end, x}`). A range whose end
  is below its start runs zero times. `{#for i in 1...5}` is an error that
  steers to `{#for 1...5, i}`: the counter always comes after the range. The
  collection is any expression, a method chain included:
  `{#for t in todos.filter(t => !t.done)}`. §6.
  How PuzzleKit keys and caches rows (§28) is PuzzleKit behavior, not core.
- **The loop domain** (D173 V12): `{#for x in c}` iterates lists. A missing
  collection runs zero times with no warning; any other non-list (a string, an
  object, a number) runs zero times with a development warning. Range bounds
  are truncated toward zero, with a development warning when a bound was not an
  integer, and a missing bound runs the range zero times. Built in PuzzleKit;
  Sites still renders nothing for a non-integer bound until it adopts the rule.

## Raw and SVG blocks

- **`{#raw}…{/raw}`** makes every brace in its body literal while HTML inside
  it stays HTML. Use it for inline JSON, code samples, or anything with braces.
  It does not nest; the first `{/raw}` ends it. It is not allowed inside an
  attribute value. §57.

  ```html
  <script type="application/json">{#raw}{ "loop": true }{/raw}</script>
  ```

- **`{#svg 'path'}`** inlines an SVG file at compile time. It has no closing
  tag. The path is a static quoted string relative to the host's assets folder
  (PuzzleKit: `app/assets/`; Sites: the theme's `assets/`). Absolute paths,
  `..`, and backslashes are errors. The file's contents are copied in as they
  are: nothing inside it is interpolated. Size and color it from the parent
  (`currentColor`, a sized wrapper). §18.

  ```html
  <button><span class="size-5">{#svg 'icons/cart.svg'}</span></button>
  ```

## Comments

`{## any text }` is an inline comment; `{#comment}…{/comment}` is a block
comment whose body is ignored even if it is broken template code. Both are
removed at compile time and are allowed anywhere text is. §6.

## Components

A tag whose name does **not** start with a lowercase ASCII letter `a`–`z` is a
component. Only `a`–`z` can begin an HTML element name, so `<UserCard>`,
`<Übersicht>`, `<概要>` and `<_row>` are components, and `<straße-karte>` is a
custom element:

```html
<UserCard user={ author } size="small" />
<Frame><Frame.Wrapper>…</Frame.Wrapper></Frame>
```

- A component name is `Ident('.'Ident)*`, each segment a JavaScript
  identifier without `$`, in any script (`<Frame.Übersicht>`). The dotted form
  `<Frame.Wrapper>` is a **component family** member. Names with `-` or `:`,
  an empty segment, or a segment that starts with a digit are errors;
  lowercase tags (including custom elements with dashes) are always plain
  HTML. §65, [[DECISION-D167-COMPONENT-FAMILIES]].
- **Props are attributes at the call site.** A static value passes a string, a
  brace-only value passes the value itself (a list stays a list), and a quoted
  value with interpolations passes the assembled string. A prop name may use
  letters from any script (`<Card größe={ 3 }>`).
- `slot="name"` on a direct child routes that child to a named slot and is not
  a prop (see Slots).
- `Children`, `Slot`, `Snippet` and `Portal` are reserved tag names, so no
  component can use them, and a dotted name that starts with one
  (`<Slot.Foo>`) is an error.
- How a name finds its component file, and how the component reads its props,
  is a host rule (D173 V15). PuzzleKit resolves the name from the file's
  `<script>` imports and hands props to `data(params, props)`; a component
  file with **no** `<script>` gets a `data()` that returns its props, so
  `{ tone }` reads the `tone` prop there as it does in Sites. Sites resolves
  `components/<Name>.pzl` and exposes each prop as a bare name.

## Slots


A slot is a placeholder filled from outside the file. §24,
[[DECISION-D141-MARKER-FALLBACK-BODIES]].

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

- **`<Children/>`** receives the call site's children that carry no `slot`
  attribute.
- **`<Slot name="x"/>`** receives the children marked `slot="x"`. The name is
  static; `default` and `children` are reserved.
- **One marker per render path** ([[DECISION-D173-CORE-SEMANTICS]] V13). The
  default marker (`<Children/>` or a bare `<Slot/>`), and a `<Slot name="x">`
  for any one name, may appear once on any single render path. The exclusive
  branches of one `{#if}`/`{:else}` or `{#case}` are separate paths, so
  `{#if compact}<div><Children/></div>{:else}<section><Children/></section>{/if}`
  is legal. A marker inside a `{#for}` body is one declaration, however many
  times the loop runs.
- **Fallback bodies.** Each marker is self-closing (no fallback) or paired. A
  paired body renders only when nothing fills that position; supplied content
  replaces it entirely. A marker cannot appear inside another marker's fallback.
- **Filled means it rendered something** (V14). A position is filled only when
  the content supplied for it renders at least one node that is not
  whitespace-only text. A call-site `{#if}` that renders nothing and a `{#for}`
  over an empty list both leave it unfilled, so the fallback shows:
  `<List>{#for item in items}…{/for}</List>` with a fallback of "Nothing here
  yet" is the empty state.
- **The file's role decides who fills a slot.** In a component, the caller does.
  In a layout, the host does, and **the plain `<Slot/>` in a layout is the
  page**: the router's current view in PuzzleKit, the page template and its
  sections in Sites. A host may reserve named layout slots (Sites reserves
  `head-content`, `header-group`, `footer-group` and `panel-group`).
- **Forwarding.** `<Children/>` placed inside another component's call site
  passes this file's default content through to that component
  ([[DECISION-D71-SLOT-FORWARDING]]).
- The lowercase spellings `<slot>` and `<children>` are errors that steer to the
  capitalized form.

## Snippets

A **snippet** is a template the caller hands a component that owns a loop (a
table cell, a list row, a carousel slide). The component stamps it once per
item with values it passes through its own marker. §64,
[[DECISION-D166-SNIPPETS]].

```html
<!-- caller -->
<UserList users={ users }>
  <Snippet user><b>{ user.name }</b></Snippet>
</UserList>

<!-- UserList.pzl -->
<ul>{#for user in users}<li><Children user={ user }>{ user.name }</Children></li>{/for}</ul>
```

- `<Snippet>` is paired only and appears only as a direct child of a component
  call. `fits="x"` routes it to `<Slot name="x">`; without `fits` it fills the
  `<Children>` position.
- Every other `<Snippet>` attribute is **bare** and declares a parameter. A
  marker's valued attributes (other than `name`) are the arguments, matched to
  parameters by name.
- A snippet body is a **leaf**: no `<Children>`, `<Slot>`, nested `<Snippet>` or
  `ref` inside it, at any depth.
- A bare `<Children/>` in a wrapper forwards the caller's snippets to the
  wrapped component along with its default content.

Snippets are core. PuzzleKit implements them; Sites has not built them yet and
rejects them until it does.

## Expressions



A template expression is **JavaScript's expression syntax, closed by one
grammar and a method table** ([[DECISION-D176-EXPRESSION-LANGUAGE]]). One
parser in the language module (`packages/puzzle-lang/expr`) reads every
expression into a tree both hosts consume: PuzzleKit lowers it to JavaScript,
Sites evaluates it in Go. Anything outside the grammar is a positioned compile
error in both hosts, at the same line and column, whose message names the
construct and what to write instead. Every expression position takes the same
grammar: text, attribute values, props, marker arguments, conditions, `{:when}`
values, `{#for}` headers, and PuzzleKit's `@event` handler arguments.

**A template expression never reaches the view instance.** Every value it
shows comes through `data()` and the model (PuzzleKit) or the render context
(Sites). A value that needs more logic than an expression holds is computed
first — in a `data()` field (PuzzleKit) or a `{#let}` (Sites) — and read as a
plain value. PuzzleKit's one door into the view's JavaScript is an `@event`
handler (see Handlers below).

**Names.** An identifier reads from the scope the host supplies (PuzzleKit:
`data()` fields; Sites: the render context and props), plus the names the
template binds: `{#for}` items and counters, `<Snippet>` parameters and arrow
parameters. Identifiers follow JavaScript's `ID_Start`/`ID_Continue`, so
letters, digits and marks from any script, `_` and `$` all work
(`{ größe }`). Reserved words are errors, except `eval` and `arguments`, which
read like any field. `__proto__`, `constructor` and `prototype` are errors as
member names and object keys. A bound name is a value: calling it (`t('key')`
inside `{#for t in …}`) is an error. `event` is an ordinary name too, except
inside a PuzzleKit `@event` handler (see Handlers below).

- **`this` is not a name** in any template expression, handler arguments
  included. It is a positioned compile error at the `this` token that steers
  to a `data()` field or a function (D176 rule 7). A field named `this` is an
  ordinary member read (`x.this`).
- **The page's global objects are not template data.** `window`, `document`
  and `globalThis` read as a data root are an error: "`window` is not
  available in template expressions — read it in data() and pass the value".
  A binding or arrow parameter with one of those names is fine. Every other
  name is an ordinary data read, `location` and `localStorage` included: it
  reads the `data()` field of that name, never the browser's.

**Literals.**

| Kind | Examples |
|---|---|
| number | `12`, `1.25`, `.5`, `1e3` — decimal only; hex, octal, binary, BigInt, `1_000` and a leading zero are errors |
| string | `'quiet'`, `"quiet"`, with JavaScript's strict-mode escapes (`\n`, `\xHH`, `\u{…}`, …); a raw line break or a legacy octal escape is an error |
| template literal | `` `${first} ${last}` `` |
| boolean | `true`, `false` |
| absent | `null`, `undefined` |
| number constants | `NaN`, `Infinity` |
| list | `[]`, `[price, qty]` |
| object | `{ height: 480 }`, `{ 'cart.count': n }`, `{ count }` — never at the start of an expression |

**Object literals** (D173 V8) take identifier keys, quoted keys and shorthand,
with expressions as values; computed keys, spread, methods and numeric keys
are errors. An expression cannot start with one, where `{ {` reads as a
doubled interpolation brace, so its place is a function argument:
`{ t('cart.items', { count: items.length }) }`.

**Access.** `a.b`, `a?.b`, `a[expr]`, `a?.[expr]`. **Reading a member of a
missing value yields a missing value, and so does calling a method on one**
(D173 V4), and a missing value prints nothing: `{ a.b.c }` with `a.b` unset,
or `{ note.trim() }` with `note` unset, renders an empty string in both hosts.
`?.` is legal and unnecessary. PuzzleKit guards every member step, index step
and method call in codegen; a path that exists evaluates exactly as before.
The same holds for the `Object` globals: `Object.keys`, `values` and `entries`
of a missing value are `[]`, so `{ Object.keys(settings).length }` prints `0`
(PuzzleKit passes `x ?? {}`; Sites needs the same default).
`.size` is not special: it reads a field named `size` like any other
(`file.size`).

**Calls.** Three kinds, and nothing else is callable:

- **A function**, `name(args)`. A bare call resolves to the function library
  (see Standard functions), never to data; a bare name resolves to data, never
  to a function, so the two cannot shadow each other: `{ currency(price) }`,
  `{ date(post.createdAt, 'long') }`, `{ specialFormat(product.title) }` (an
  app's own function).
- **A method**, `value.m(args)` or `value?.m(args)`, from the method table:

  | Receiver | Methods |
  |---|---|
  | string | `length` (a property, in UTF-16 units), `at`, `charAt`, `includes`, `startsWith`, `endsWith`, `indexOf`, `lastIndexOf`, `slice`, `substring`, `split`, `replace` (first occurrence), `replaceAll`, `trim`, `trimStart`, `trimEnd`, `toUpperCase`, `toLowerCase`, `padStart`, `padEnd`, `repeat`, `concat` |
  | list | `length` (a property), `at`, `includes`, `indexOf`, `lastIndexOf`, `slice`, `concat`, `join`, `flat`, `find`, `findIndex`, `findLast`, `filter`, `map`, `some`, `every`, `reduce`, `toSorted`, `toReversed` |
  | number | `toFixed`, `toString` (no radix) |
  | boolean, `null`, `undefined`, a record, an object | none: read an object's fields, or iterate it with `Object.keys`, `values` or `entries` |

  Each means what it means in JavaScript, and none mutates its receiver: there
  is no `push`, `sort`, `reverse` or `splice`. A name outside the table is an
  error that names the alternative (`sort` → `toSorted()`, `push` →
  `concat()`, `substr` → `slice()`, `getFullYear` → `date(v, preset)`).
  `.length()` is an error; `.length` is a property. When the syntax fixes the
  receiver's type — a literal, a template literal, `Math.PI`, a global call
  such as `Number(x)` — the method is checked against that type at parse time,
  so `'s'.filter(f)` is an error in both hosts. On a data path the name only
  has to be in the table; PuzzleKit's `puzzle check` then type-checks it as the
  same JavaScript method, and Sites checks the runtime type.
- **A global**, from a fixed list: `Math.abs`, `ceil`, `floor`, `round`,
  `trunc`, `max`, `min`, `sign`, `pow`, `sqrt` and the constants `Math.PI` and
  `Math.E`; `Number(x)`, `String(x)`, `Boolean(x)`; `Array.isArray(x)`;
  `Object.keys`, `values`, `entries(x)`; `parseInt`, `parseFloat`, `isNaN`,
  `isFinite`; and the pure URI functions `encodeURIComponent`,
  `decodeURIComponent`, `encodeURI` and `decodeURI`
  (`href="/search?q={ encodeURIComponent(query) }"`). There is no `Date`,
  `JSON`, `Intl`, `Map`, `Set` or `fetch`; dates and JSON display through
  `date()` and `json()`. A global is only ever called: `items.filter(Boolean)`
  is an error that says `x => Boolean(x)`.

A computed method call (`a[name]()`), calling a call's result (`f(x)(y)`) and
an optional call (`f?.(x)`) are errors.

**Arrow functions** appear only as call arguments, with an expression body and
plain parameters: `todos.filter(t => !t.done)`,
`rows.toSorted((a, b) => a.rank - b.rank)`, `items.map((item, i) => i + 1)`.
A callback receives `(item, index)`. An object body is written
`x => ({ … })`; defaults, rest and destructuring are errors.

**Operators**, loosest binding first:

| Operator | Meaning |
|---|---|
| `c ? a : b` | ternary; only the chosen branch is evaluated |
| `a ?? b` | `b` when `a` is `null` or `undefined`, else `a` (`0`, `''`, `false` are kept) |
| `a \|\| b` | `a` if truthy, else `b` (returns an operand, not a boolean) |
| `a && b` | `a` if falsy, else `b` |
| `==` `!=` | JavaScript loose equality (`1 == '1'` is true; `x == null` is true for both absent values) |
| `===` `!==` | strict equality; lists and objects compare by identity |
| `<` `<=` `>` `>=` | number with number, or string with string |
| `+` `-` | numbers; `+` concatenates when either side is a string |
| `*` `/` `%` | numbers |
| `!x` `-x` `+x` | prefix; `!x` is always a boolean, `+x` converts to a number |
| `.` `?.` `[…]` `(…)` | postfix member access and calls, binding tightest |

- **`==` and `!=` mean what they mean in JavaScript** (D173 V2): PuzzleKit
  compiles them unchanged (pinned by a codegen test); Sites implements
  JavaScript's loose-equality algorithm when it adopts V2.
- **Test for a missing value with `x == null`** (D173 V3). It is true for both
  `null` and `undefined` in both hosts. What `x === null` or `x === undefined`
  returns is host-defined: PuzzleKit follows JavaScript (`undefined === null`
  is false), while Sites has one absent value.
- **A fallback is `??`, never `||`** (D176): `{ nickname ?? name }` replaces
  only a missing value, so `{ count ?? 'none' }` still prints `0`, where `||`
  would swallow `0` and `''`.
- **`??` may not be mixed with `&&` or `||` without parentheses.**
  `a ?? b || c` is an error that offers `(a ?? b) || c` and `a ?? (b || c)`,
  as in JavaScript; the shared parser reports it for both hosts.
- **Truthiness:** `false`, `0`, `NaN`, `''`, `null` and `undefined` are falsy.
  Everything else is truthy, **including an empty list and an empty object**.
  Test `items.length > 0` when you mean "has items".
- **Math is the operators and `Math.*`** (D176), then a function to present
  the result: `{ currency(price * qty) }`, `{ round(total / count, 1) }`,
  `{ Math.max(0, remaining) }`. `round` is a function because it takes decimal
  places, which `Math.round` does not.
- **A date value** takes only `<`, `<=`, `>`, `>=` and binary `-`, which
  coerce it to milliseconds in both hosts. It has no methods, and a template
  cannot construct one (there is no `new` and no `Date`). Display it with
  `date()`, `time()`, `datetime()` or `timeago()` (D176 rule 6).

**Not in the language, and a compile error in both hosts** (D176): the bitwise
operators (a `|` gets the pipe steer above), `**` (write `Math.pow`), `in`,
`instanceof`, `typeof`, `void`, `delete`, `new`, the comma operator,
assignment, `++`/`--`, regular expressions, comments, statements, `function`,
classes, `await`/`yield`, tagged templates and spread. Arithmetic or comparison
on operands of mixed or non-number types is host-defined (V5).

**Constant arguments are checked.** A string-literal preset that `date`,
`time` or `datetime` does not know (`time(v, 'shrot')`), or a string-literal
`in_timezone` zone that cannot be a zone id, draws a positioned compile
warning in PuzzleKit that names the valid presets. It is a warning, not an
error, because an app may register its own function under any of those names.
A dynamic preset the library does not know is a development error at run time
that renders the function's default (D174). A zone `Intl` rejects renders the
date un-shifted, with a development error once per zone; a `null` or `''` zone
renders un-shifted with no error, and an omitted zone is `'UTC'`.

**Handlers (PuzzleKit only).** An `@event` value is the one door into the
view's JavaScript: a bare handler name, one call to a handler, a conditional
whose branches are each one of those or `null`, or `null`
(`@click={ save(items.length - 1) }`). The handler's own call names the view's
handler, never a library function; its arguments are ordinary expressions,
evaluated when the event fires, with `event` in scope, and the conditional's
test is an ordinary expression evaluated at render time. A chain rooted at a
free `event` in the arguments is the DOM event, not template data, so the
method table does not apply to it: `event.target.value`,
`event.target.closest('li')` and `event.preventDefault()` are legal and
compile as written. A bound `event` (a loop item, a snippet or arrow
parameter) shadows the DOM event, as in JavaScript. Outside a handler `event`
is an ordinary name that reads the data field or prop, so
`<EventCard event={ item }>` and its `{ event.title }` work. Inside a handler
the free `event` is always the DOM event, so a template that reads `event` as
data and also uses it inside a handler is a positioned compile error at the
handler's use, naming the data read: rename the field or prop. Sites has no
handlers and rejects `@event` (see Dialects).

## Dialects




| | PuzzleKit | Sites |
|---|---|---|
| File structure | `<puzzle-view>` root (§3); optional `<puzzle-skeleton>` (§16), `<script>` class (§4, `lang="ts"` §25), `<style>` / `<style scoped>` (§29) | No wrapper; the directory decides the file kind; optional `<schema>`, `<script>` (browser JavaScript), `<style>` / `<style scoped>` — `sites/constellation/decision/DECISION-TEMPLATE-GRAMMAR.md`, `DECISION-NO-VIEW-WRAPPERS-IN-THEMES.md` |
| Expressions | The D176 grammar, method table and globals, lowered to JavaScript; plus the `@event` handler, the one door into the view's JavaScript, whose free `event` chain is the DOM event and skips the method table ([[DECISION-D176-EXPRESSION-LANGUAGE]]) | The same grammar and table once its Go evaluator reads the shared tree (D176 P6, planned); a shared-table entry Sites switches off is a positioned error there (D176 rule 5). Today its own `engine/expr` allow-list, with pipes and with `==` spelled as `===` until V2 lands — `DECISION-EXPRESSION-SUBSET.md` |
| Naming a computed value | a `data()` field (no `{#let}`: logic belongs in the script) | `{#let}` |
| Adds | `@event` + modifiers (§5, §47); callback props (§6); implicit two-way binding (§6, [[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]); `<Portal>` ([[DECISION-D144-PORTAL]]); `island` (§17); `key` (§28); `ref` (§38); `flip` (§46); the functions `link` and `timeago`, and an app's own functions (the `formatters` config); a script-less component reads its props (V15) | `{#let}` template variables (its value is one more expression position); implicit props (bare names); `<Form>`; reserved layout slots and section groups; Sites-only functions (`url`, `asset_url`, `menu_link`, `image_url`, `image_srcset`, `image_tag`, `class_map`) — `sites/engine/constellation/doc/DOC-TEMPLATE-LANGUAGE.md` |
| Restricts | — | `@event` and `<Portal>` are compile errors; `ref`/`key`/`flip`/`island` are dropped with a warning; an unknown function or a wrong argument count is a compile error; interpolation is not allowed in `<script>`/`<style>` bodies or event-handler attributes — `DECISION-AUTO-ESCAPE.md` |
| Not yet built | — | `<Snippet>` and marker arguments (core; planned); the Go evaluator over the shared expression tree and the function library (D176 P6) |

## Section map



SPEC section numbers never move. This map says which sections describe the core
and which describe the PuzzleKit dialect. A section marked **core** can still
carry PuzzleKit-only detail (runtime cost, diagnostics, tooling); the note says
which part.

**[[DOC-SPEC-TEMPLATE]]**

| § | Section | Layer | Note |
|---|---|---|---|
| 5 | Event handler convention | PuzzleKit | `@event` forms and modifiers |
| 6 | Template grammar | mixed | see the §6 breakdown below |
| 17 | DOM islands | PuzzleKit | |
| 18 | Inline SVG `{#svg}` | core | the `app/assets/` root, dev watch and `pzlc --assets` are PuzzleKit |
| 24 | Composition markers | core | markers, fallbacks, named slots, `slot=` routing, forwarding; "the router fills the default slot" is PuzzleKit's layout host rule |
| 28 | List keying | PuzzleKit | row keys and caching; `key=` is a PuzzleKit attribute |
| 31 | Cached event handlers | PuzzleKit | |
| 43 | Compiler accessibility warnings | PuzzleKit | compiler diagnostics |
| 47 | `@event:outside` | PuzzleKit | |
| 57 | Raw blocks `{#raw}` | core | the prerender escaping paragraph is PuzzleKit |
| 64 | Snippets | core | the `__PUZZLE_HAS_SNIPPETS__` cost and dev diagnostics are PuzzleKit |
| 65 | Component families | core | the tag-name grammar is core; the `Object.assign` barrel, lexical resolution and `generate component --family` are PuzzleKit |

**§6 breakdown**

| §6 item | Layer |
|---|---|
| Interpolation and nullish display | core (the undefined-value dev warning is PuzzleKit) |
| Expression boundary | core (the D176 grammar, method table and globals; no `this`); the handler door and its `event` chain are PuzzleKit |
| Functions | core call syntax and the standard library (D174); the purity contract (D170), the unknown-name guard, app-registered functions, `link`, `timeago` and the calendar-date rule are PuzzleKit |
| Conditionals, `{:else if}`, `{#unless}`, `{#case}` | core |
| Loops | core forms; auto-keying is PuzzleKit (§28) |
| Attribute values (interpolation, inline `{#if}`) | core |
| Bindings: dynamic attributes | core |
| Bindings: implicit two-way binding | PuzzleKit |
| Events, callback props | PuzzleKit |
| Components (tag grammar), component children | core; import resolution is PuzzleKit |
| Layout slot | core |
| DOM islands, element refs | PuzzleKit |
| Comments | core |
| Raw blocks | core |

**[[DOC-SPEC-ANATOMY]]** (template-relevant sections only)

| § | Section | Layer |
|---|---|---|
| 3 | `.pzl` file anatomy | PuzzleKit (the `<puzzle-view>` wrapper and sections) |
| 4 | `<script>` blocks are real JavaScript | PuzzleKit |
| 10 | Component context | PuzzleKit |
| 11 | Project layout (`app/assets/` for `{#svg}`) | PuzzleKit |
| 25 | TypeScript scripts | PuzzleKit |
| 29 | Scoped styles | PuzzleKit (Sites has its own `<style scoped>`, see V18) |
| 40 | The `@` module alias | PuzzleKit |

Template-relevant sections in DOC-SPEC-VIEW are all PuzzleKit: §12 animations,
§16 `<puzzle-skeleton>`, §38 `ref`, §46 `flip`.

## Standard functions

[[DECISION-D174-STANDARD-FORMATTERS]] fixes the **standard library: 19
functions** with the same arguments and meaning in both hosts. The shared
conformance table (`packages/puzzle-lang/conformance/functions.json`, embedded
by the language module's `conformance` package, so both hosts run the same rows
at the same module version) pins the identical-output ones and the
locale-independent rows of the rest. D174 has each function's contract; this
table records where each host stands against it. `t` is defined by
[[DECISION-D175-TRANSLATIONS]]. A name that a JavaScript method, an operator or
a `Math` global already spells is not a function
([[DECISION-D176-EXPRESSION-LANGUAGE]]).

**PuzzleKit implements the library.** `client-runtime/formatters/builtins.js`
is the standard set without `t`, plus `timeago`; the registry adds the
router-backed `link`, and the i18n service adds `t` when the app configures
translations (21 names). With translations configured, the locale-rendered
rows follow the app's active locale instead of the viewer's (D175). `raw` and
`newline_to_br` render real markup: a text interpolation whose outermost call
is either compiles to a live-HTML node, `raw` through the shared allowlist
sanitizer, and either anywhere else is a compile error. A call to a removed
name passes the value through with a development error that names the
replacement.

**Sites has not moved yet** (`sites/engine/engine/formatters/*.go`, 61 names
including four aliases, applied with pipes); its column describes today's
registry. It takes the library up with its Go evaluator (D176 P6).

Counts: 19 standard (12 identical-output, 6 locale-rendered, 1 translation),
2 PuzzleKit-only, 7 Sites-only, and Sites' list formatters, open until P6.

| Name | PuzzleKit | Sites today | Status |
|---|---|---|---|
| `round` | as D174: half away from zero on the decimal value, negative places; returns a number | same rule on the binary value (`1.005` → `1.00`) | standard; Sites pending (F19 fixture) |
| `currency` | as D174: `-$1,234.50` | same | standard (F3) |
| `percentage` | as D174: the number as written | same | standard (F14) |
| `capitalize` | as D174: first character only | same | standard (F1) |
| `truncate` | as D174: code points, length optional, never over length | length required | standard; Sites pending (F25) |
| `strip_html` | as D174: quote-aware scanner | same | standard (F23) |
| `strip_newlines` | as D174: CR and LF | same | standard (F24) |
| `escape` | as D174: identity on text | drops the trusted-markup mark | standard (F8) |
| `raw` | as D174: sanitized markup through the shared allowlist; only the outermost call of a text interpolation | trusted markup, unsanitized | standard; Sites pending the render-time sanitizer (F16) |
| `newline_to_br` | as D174: escapes, then markup `<br>` for CR LF, CR and LF; only the outermost call of a text interpolation | same | standard (F12) |
| `json` | as D174: sorted keys, missing / non-finite → `null` | Go encoder; NaN errors | standard; Sites pending (F9) |
| `in_timezone` | as D174: re-expresses an instant in a zone for `date`/`time`/`datetime` to present; a literal zone that cannot be a zone id draws a compile warning | — | standard; new to Sites |
| `date`, `time`, `datetime` | as D174: `short`/`medium`/`long`/`iso`, viewer locale and zone; with no preset the medium date, the short time, and the medium date with the short time; a literal preset the library does not know draws a compile warning | same presets, en-US, the value's own zone | locale-rendered; Sites pending the site zone and the defaults (F4–F6) |
| `number_with_delimiter` | as D174: viewer locale; explicit delimiter forces one | fixed `,` | locale-rendered; Sites pending |
| `compact_number` | `Intl` compact notation | — | locale-rendered; Sites pending |
| `pluralize` | as D174: count in the viewer locale, then the word | ungrouped count, then the word | locale-rendered; Sites pending (F15) |
| `t` | as D175: `t(key, vars)`; the active locale's build-filled table, the key itself on a miss, single-pass `{name}`, CLDR plural entries chosen by a numeric `count` through `Intl.PluralRules`, `{count}` in the locale's number format; present only with `i18n` configured | lookup with the `en` fallback, the key on a miss, single-pass `{name}`; flat files, no plurals | standard (D175); Sites pending plural entries, nested files and the `{count}` number format |
| `link` | router-aware href for a path (§6, D79) | — (Sites has `url`) | PuzzleKit-only |
| `timeago` | relative time, read from the clock at render time | — (no clock at render time, by design) | PuzzleKit-only |
| `upcase`, `downcase`, `trim`, `strip`, `replace`, `join`, `abs`, `ceil`, `floor` | removed: `.toUpperCase()`, `.toLowerCase()`, `.trim()`, `.replaceAll()`, `.join(', ')`, `Math.abs`/`ceil`/`floor` (development names the replacement) | in the registry | removed from both (D176); Sites pending |
| `size`, `plus`, `minus`, `times`, `divided_by`, `modulo`, `default` | removed: `.length`, the operators, `??` | in the registry | removed from both (D176); Sites pending |
| `noescape` | removed: `raw` | alias of `raw` | removed from both; Sites pending |
| `upper`, `lower` | — | aliases of `upcase`, `downcase` | removed from Sites; pending |
| `split` | removed: `.split()` | separator required, nil stays nil | the method covers it; Sites decides at P6 |
| `sort`, `where`, `map`, `uniq`, `reverse`, `compact`, `first`, `last` | removed: `.toSorted()`, `.filter()`, `.map()`, `.toReversed()`, `.filter(x => x != null)`, `.at(0)`, `.at(-1)`; `uniq` is `data()` | list formatters | the methods cover most; Sites decides at P6 |
| `reject`, `find`, `sort_natural`, `slice`, `sum`, `concat`, `push`, `contains`, `group_by` | — (`.filter()`, `.find()`, `.slice()`, `.concat()`, `.reduce()`, `.includes()`) | list queries and list building | the methods cover most; Sites decides at P6 |
| `url`, `asset_url`, `menu_link`, `image_url`, `image_srcset`, `image_tag` | — | platform-bound | Sites-only |
| `class_map` | — | class names from a map | Sites-only |

## Known divergences

Same syntax, different result. [[DECISION-D173-CORE-SEMANTICS]] decides every
item. An entry marked **PuzzleKit follows the core** is built in PuzzleKit (the
rule is stated in the core sections above); it stays listed until Sites changes
too.

**Resolved in the core above** (expressions and loops): V1 (every expression
position is one expression of the D176 grammar; a display transform is a
function call, and a `|` is an error), V2 (`==`/`!=` are JavaScript loose
equality), V3 (`x == null` is the portable absence test; strict comparison
against `null`/`undefined` is host-defined), V4 (reading through a missing
value, or calling a method on one, prints nothing), V7 (the count is
`.length`, and strings follow JavaScript's UTF-16 units, case mapping and
whitespace set), V8 (object literals as values, never at the start of an
expression), V15 (a script-less PuzzleKit component reads its props), and
[[DECISION-D176-EXPRESSION-LANGUAGE]]'s closed grammar, method table and
function library. PuzzleKit implements all of them. Sites takes them up with
its Go evaluator over the shared tree (D176 P6): V2's loose equality, V7's
string semantics (it counts runes today, and `'ß'` upper-cases to `ß`), and
the library's removals.

**Host-specific by decision:**

- **V5 — arithmetic and comparison on non-numbers.** `'2' * 3`, `null + 1`,
  `-'2'`, `1 < '2'`: PuzzleKit follows JavaScript's coercion; Sites yields a
  missing value with a warning. A date orders and subtracts to milliseconds in
  both hosts. Authors coerce in `data()` (PuzzleKit) or a `{#let}` (Sites).
- **V17 — function failure policy.** An unknown name or a wrong argument count
  is a compile error in Sites. In PuzzleKit the value passes through with a
  development error (naming the replacement for a removed name), because app
  functions register at runtime; `puzzle check` types the standard functions'
  arguments, and a literal date preset or zone the library does not know draws
  a compile warning. Out-of-domain input is coerced or passed through in
  PuzzleKit, and warns and renders nothing in Sites.
- **V18 — scoped styles.** Both hosts accept `<style scoped>` with the same
  stamping algorithm but different prefixes and targets (PuzzleKit:
  `data-pzl-…` on the template root; Sites: `data-sites-…` on `<html>`, a
  section wrapper, or a component root).

**Decided, Sites still to change:**

- **V6 — value printing. PuzzleKit follows the core** (see Interpolation and
  functions). Sites still prints an object as `[object]` and a number at or
  above 1e21 (or below 1e-6) as plain digits instead of exponent form.
- **V9 — list and object values in a brace-only attribute. PuzzleKit follows
  the core** (see Attributes). Sites today joins a list with spaces and drops
  an object with a warning; dropping `false` and empty items from the list is
  still pending in Sites, so `class={ [active && 'on', 'btn'] }` can differ
  there until it lands. Listed until the shared conformance fixture pins both
  hosts.
- **V10 — whitespace. PuzzleKit follows the core** (see Markup and text,
  [[DECISION-D168-TEXT-RUN-WHITESPACE]]). Sites still keeps newline-bearing
  whitespace between two inline siblings, so indentation between buttons
  becomes a gap there, and still drops the gap between an interpolation and a
  following `{#if}`, gluing the two words.
- **V11 — text inside `{#raw}`. PuzzleKit follows the core:** raw text is not
  entity-decoded, so `{#raw}&amp;{/raw}` displays `&amp;`. Sites still writes
  raw text unescaped, so the browser displays `&`; it changes to escape `&`,
  `<` and `>` there, except inside `<script>` and `<style>`.
- **V12 — the loop domain. PuzzleKit follows the core** (see Control blocks).
  Sites still renders nothing for a non-integer range bound instead of
  truncating it, and warns on a map rather than on every non-list.
- **V13 — markers in exclusive branches. PuzzleKit follows the core** (see
  Slots): the check lives in the shared parser, so Sites follows it too at its
  next parser sync; it already allowed one marker per render path.
- **V14 — when is a slot "filled"? PuzzleKit follows the core** (see Slots).
  Sites still counts an empty `{#for}` and a call-site `{#if}` that renders
  nothing as filled, so its fallback stays hidden.
- **V16 — dotted component tags in Sites.** Family tags are core, and the
  shared parser accepts `<Frame.Wrapper>`, but Sites rejects a dotted tag for
  now with a positioned error saying component families are not supported
  there yet.
- **V18 — `{#svg}` paths.** The path is relative to the host's assets root in
  both hosts. Sites still accepts an explicit `assets/` prefix, which
  PuzzleKit resolves as `app/assets/assets/…`; it changes to a compile error
  that steers to the bare path.
