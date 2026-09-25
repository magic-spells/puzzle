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
capitalized tags (`<Children/>`, `<Slot>`, components). That shared part is the
**core**. Each host that runs Puzzle is a **dialect** of it:

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
implementations still break the rule are listed at the end of this card as open
questions.

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
- **Text is not entity-decoded.** Write the character you mean. `&amp;` in
  template text or in a static attribute value displays as the five characters
  `&amp;`, not as `&`.
- **HTML comments `<!-- … -->` are removed at compile time.** They never reach
  the output.
- **Whitespace** ([[DECISION-D168-TEXT-RUN-WHITESPACE]], §6): a run of spaces,
  tabs and newlines collapses to one space. Whitespace that contains a newline
  and sits between elements (source indentation) is dropped. Inside a run of
  text and interpolations, a newline still separates words, so
  `{ user.first }` and `{ user.last }` on two lines render `John Doe`.
  `{ a }{ b }` with nothing between them stays adjacent. The two hosts do not
  yet agree on every edge of this rule; see V10.

```html
<p>Price: \{ not an interpolation \}</p>
```

## Interpolation and formatters



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

A **formatter** transforms a value for display. Write it after a pipe:

```html
<p>{ post.title | upcase }</p>
<p>{ post.body | truncate(120) }</p>
<p>{ product.name | trim | capitalize }</p>
<a title="{ price | currency }">…</a>
```

- `{ value | name }` or `{ value | name(arg, arg) }`. Arguments are
  expressions, in parentheses, separated by commas.
- Chains run left to right and have no length limit.
- Only a **top-level single `|`** is a pipe. `||` is logical OR, and a `|`
  inside a string, parentheses or brackets is not a pipe.
- A formatter should be a pure function of its input. In PuzzleKit, filtering
  and sorting belong in `data()`; Sites, which has no script, provides list
  formatters for them.

Core positions for a formatter chain: text interpolation and **quoted**
attribute values. The unquoted attribute form `title={ price | money }` is where
the hosts currently disagree (V1). A block header (`{#if}`, `{#for}`,
`{#case}`) takes a plain expression, not a chain.

Which formatter names exist is a host decision; the names both hosts implement
identically are the **standard set** (see Standard formatters below). Full
PuzzleKit contract: §6 and [[COMPONENT-FORMATTERS]].

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
- A list writes its items, each printed by the value rule above, joined with
  single spaces, so `class={ ['card', active ? 'is-active' : null] }` works.
  (Text and quoted attributes keep the `,` join, and a list passed to a
  component as a prop stays a list.)
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
  not `{:else if}`. §6.
- **`{#case expr}`** compares with strict equality. A `{:when}` may list several
  values, separated by commas, as alternatives. The first match wins and there
  is no fall-through. Only whitespace may appear before the first `{:when}`, and
  `{:else}` must be last. §6.
- **`{#for}`** has four forms:

  | Form | Binds |
  |---|---|
  | `{#for item in items}` | each item |
  | `{#for item in items, i}` | each item and its 0-based index |
  | `{#for 1...n}` | nothing; runs for each whole number from 1 to n, inclusive |
  | `{#for 1...n, x}` | the current number |

  Both range bounds are expressions (`{#for start...end, x}`). A range whose end
  is below its start runs zero times. `{#for i in 1...5}` is an error that
  steers to `{#for 1...5, i}`: the counter always comes after the range. §6.
  How PuzzleKit keys and caches rows (§28) is PuzzleKit behavior, not core.

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

A **capitalized tag** is a component:

```html
<UserCard user={ author } size="small" />
<Frame><Frame.Wrapper>…</Frame.Wrapper></Frame>
```

- A component name is `Ident('.'Ident)*`. The dotted form `<Frame.Wrapper>` is
  a **component family** member. Names with `-` or `:` are errors; lowercase
  tags (including custom elements with dashes) are always plain HTML. §65,
  [[DECISION-D167-COMPONENT-FAMILIES]].
- **Props are attributes at the call site.** A static value passes a string, a
  brace-only value passes the value itself (a list stays a list), and a quoted
  value with interpolations passes the assembled string.
- `slot="name"` on a direct child routes that child to a named slot and is not
  a prop (see Slots).
- `Children`, `Slot`, `Snippet` and `Portal` are reserved tag names, so no
  component can use them, and a dotted name that starts with one
  (`<Slot.Foo>`) is an error.
- How a name finds its component file, and how the component reads its props,
  is a host rule. PuzzleKit resolves the name from the file's `<script>`
  imports and hands props to `data(params, props)`. Sites resolves
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

The **core expression language** is the part of JavaScript expression syntax
that both hosts evaluate the same way. It is based on Sites'
`DECISION-EXPRESSION-SUBSET` (`sites/constellation/decision/`). PuzzleKit
accepts JavaScript expressions, a superset of the core, within the §6
expression boundary (template expressions are lexed, not parsed: no arrow
functions, no object literal at the start of an expression, no destructuring).
Sites accepts exactly the core plus two additions (object literals, `==` as a
spelling of `===`).

**Names.** An identifier reads from the scope the host supplies (PuzzleKit:
`data()` fields; Sites: the render context and props) plus the loop variables
of enclosing `{#for}` blocks. Identifiers may use letters from any script, `_`
and `$`.

**Literals.**

| Kind | Examples |
|---|---|
| number | `12`, `1.25`, `.5`, `1e3` (decimal only) |
| string | `'quiet'`, `"quiet"`; escapes `\'` `\"` `\\` `\n` `\t` only |
| boolean | `true`, `false` |
| absent | `null`, `undefined` |
| list | `[]`, `[price, qty]` |

**Access.** `a.b`, `a?.b`, `a[expr]`, and `.length` on strings and lists.
Reading a member of an absent value is not portable (V4): write `a?.b` when `a`
may be missing.

**Operators**, loosest binding first:

| Operator | Meaning |
|---|---|
| `c ? a : b` | ternary; only the chosen branch is evaluated |
| `a ?? b` | `b` when `a` is `null` or `undefined`, else `a` (`0`, `''`, `false` are kept) |
| `a \|\| b` | `a` if truthy, else `b` (returns an operand, not a boolean) |
| `a && b` | `a` if falsy, else `b` |
| `===` `!==` | strict equality; lists and objects compare by identity |
| `<` `<=` `>` `>=` | number with number, or string with string |
| `+` `-` | numbers; `+` concatenates when either side is a string |
| `*` `/` `%` | numbers |
| `!x` `-x` | prefix; `!x` is always a boolean |
| `.` `?.` `[…]` | postfix, binds tightest |

- **`??` may not be mixed with `&&` or `||` without parentheses.**
  `a ?? b || c` is an error; write `(a ?? b) || c` or `a ?? (b || c)`. (This is
  JavaScript's own rule: Sites reports it at compile time, PuzzleKit's bundler
  rejects it.)
- **Truthiness:** `false`, `0`, `NaN`, `''`, `null` and `undefined` are falsy.
  Everything else is truthy, **including an empty list and an empty object**.
  Test `items.length` when you mean "has items".

**Not in the core:** function and method calls (a formatter is the portable way
to run code), assignment, `++`/`--`, arrow functions, `new`, `typeof`,
`instanceof`, `in`, template literals, regular expressions, the comma operator,
bitwise operators, spread, `this`, object literals (V8), and loose equality
`==`/`!=` (V2). Arithmetic or comparison on operands of mixed or non-number
types is not portable either (V5).

## Dialects

| | PuzzleKit | Sites |
|---|---|---|
| File structure | `<puzzle-view>` root (§3); optional `<puzzle-skeleton>` (§16), `<script>` class (§4, `lang="ts"` §25), `<style>` / `<style scoped>` (§29) | No wrapper; the directory decides the file kind; optional `<schema>`, `<script>` (browser JavaScript), `<style>` / `<style scoped>` — `sites/constellation/decision/DECISION-TEMPLATE-GRAMMAR.md`, `DECISION-NO-VIEW-WRAPPERS-IN-THEMES.md` |
| Expressions | JavaScript, a superset of the core, within the §6 expression boundary | The core subset, plus object literals and `==` as `===` — `DECISION-EXPRESSION-SUBSET.md` |
| Adds | `@event` + modifiers (§5, §47); callback props (§6); implicit two-way binding (§6, [[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]); `<Portal>` ([[DECISION-D144-PORTAL]]); `island` (§17); `key` (§28); `ref` (§38); `flip` (§46); formatters `link`, `timeago`, `in_timezone` | `{#let}` template variables; implicit props (bare names); `<Form>`; reserved layout slots and section groups; a formatter chain in an unquoted attribute (proposed core, V1); Sites formatters (`default`, `url`, `image_url`, `t`, …) — `sites/engine/constellation/doc/DOC-TEMPLATE-LANGUAGE.md` |
| Restricts | — | `@event` and `<Portal>` are compile errors; `ref`/`key`/`flip`/`island` are dropped with a warning; an unknown formatter or a wrong argument count is a compile error; interpolation is not allowed in `<script>`/`<style>` bodies or event-handler attributes — `DECISION-AUTO-ESCAPE.md` |
| Not yet built | — | `<Snippet>` and marker arguments (core; planned) |

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
| Expression boundary | PuzzleKit (the JavaScript superset) |
| Formatters | core syntax; the purity contract (D170), the unknown-formatter guard, `link` and the calendar-date rule are PuzzleKit |
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

## Standard formatters

[[DECISION-D174-STANDARD-FORMATTERS]] fixes the **standard set: 34 names**
with the same arguments and meaning in both hosts, pinned for identical output
by the shared conformance table (`tests/conformance/formatters.json` in
`packages/puzzle`, which Sites' Go tests are to run too). D174 has each name's
contract; this table records where each host stands against it.

**PuzzleKit implements D174 groups (a) and (g)**: `client-runtime/formatters/builtins.js`
is the standard set plus `timeago` and `in_timezone`, with the router-backed
`link` added by the registry (37 names). The one PuzzleKit gap is group (e):
`raw` and `newline_to_br` still return plain text rather than sanitized markup.
**Sites has not moved yet** (`sites/engine/engine/formatters/*.go`, 61 names
including four aliases); its column describes today's registry.

Counts: 34 standard (28 identical-output, 6 locale-rendered), 3 PuzzleKit-only,
25 Sites-only.

| Name | PuzzleKit | Sites today | Status |
|---|---|---|---|
| `abs`, `ceil`, `floor`, `plus`, `minus`, `times`, `downcase`, `upcase`, `trim`, `strip`, `join` | as D174 | same | standard, both hosts |
| `divided_by`, `modulo` | as D174: a zero divisor gives a missing value | zero divisor is an error, renders empty | standard; Sites pending (F7, F11) |
| `round` | as D174: half away from zero on the decimal value, negative places | same rule on the binary value (`1.005` → `1.00`) | standard; Sites pending (F19 fixture) |
| `currency` | as D174: `-$1,234.50` | same | standard (F3) |
| `percentage` | as D174: the number as written | same | standard (F14) |
| `capitalize` | as D174: first character only | same | standard (F1) |
| `truncate` | as D174: code points, length optional, never over length | length required | standard; Sites pending (F25) |
| `replace` | as D174: replacement optional; a RegExp is a PuzzleKit addition | both arguments required | standard; Sites pending (F17) |
| `split` | as D174: separator optional, `''` → code points, missing → `[]` | separator required, nil stays nil | standard; Sites pending (F22) |
| `strip_html` | as D174: quote-aware scanner | same | standard (F23) |
| `strip_newlines` | as D174: CR and LF | same | standard (F24) |
| `escape` | as D174: identity on text | drops the trusted-markup mark | standard (F8) |
| `raw` | `String(v)`; a text node never injects markup | trusted markup, unsanitized | standard; both pending group (e) (F16) |
| `newline_to_br` | inserts `<br>` into plain text, LF only | escapes, then markup `<br>`; CR LF and CR too | standard; PuzzleKit pending group (e) (F12) |
| `default` | as D174: `0` is kept | treats `0` as falsy | standard; Sites pending |
| `size` | as D174: code points / items / keys, else `0` | runes; a missing value gives nil | standard; Sites pending (F20) |
| `json` | as D174: sorted keys, missing / non-finite → `null` | Go encoder; NaN errors | standard; Sites pending (F9) |
| `date`, `time`, `datetime` | as D174: `short`/`medium`/`long`/`iso`, viewer locale and zone | same presets, en-US, the value's own zone | locale-rendered; Sites pending the site zone (F4–F6) |
| `number_with_delimiter` | as D174: viewer locale; explicit delimiter forces one | fixed `,` | locale-rendered; Sites pending |
| `compact_number` | `Intl` compact notation | — | locale-rendered; Sites pending |
| `pluralize` | as D174: count in the viewer locale, then the word | ungrouped count, then the word | locale-rendered; Sites pending (F15) |
| `link` | router-aware href for a path (§6, D79) | — (Sites has `url`) | PuzzleKit-only |
| `timeago`, `in_timezone` | relative time; time-zone shift | — (no clock or zone at render time, by design) | PuzzleKit-only |
| `noescape` | removed | alias of `raw` | removed from both; Sites pending |
| `upper`, `lower` | — | aliases of `upcase`, `downcase` | removed from Sites; pending |
| `sort`, `where`, `map`, `uniq`, `reverse`, `compact`, `first`, `last` | removed (list shaping is `data()` or a plain expression) | list formatters | Sites-only |
| `reject`, `find`, `sort_natural`, `slice`, `sum`, `concat`, `push`, `contains`, `group_by` | — | list queries and list building | Sites-only |
| `url`, `asset_url`, `menu_link`, `image_url`, `image_srcset`, `image_tag`, `t` | — | platform-bound | Sites-only |
| `class_map` | — | class names from a map | Sites-only |

## Known divergences


Same syntax, different result. Each is an open question for a later decision,
not a fix. V1 is already on D172 as a gotcha with a proposed resolution. An
entry marked **PuzzleKit follows the core** is decided on
[[DECISION-D173-CORE-SEMANTICS]] and built in PuzzleKit (the rule is stated in
the core sections above); it stays listed until Sites changes too.

- **V1 — formatter pipe outside text and quoted attributes.** In an unquoted
  attribute, Sites runs a formatter (`title={ price | money }`), while PuzzleKit
  compiles `__d.price | __d.money`, a bitwise OR, and does the same for props
  (`<Card items={ list | sort }/>`). In `{#if}`, `{#for}` and `{#case}` headers,
  PuzzleKit also compiles a bitwise OR and Sites reports a compile error. Is the
  pipe a formatter in every expression position?
- **V2 — `==` and `!=`.** Sites treats them as `===`/`!==`; PuzzleKit uses
  JavaScript's loose equality (`1 == '1'` is true). Should core reject them or
  define them as strict?
- **V3 — `null === undefined`.** True in Sites (one absent value), false in
  PuzzleKit. Should core forbid comparing against `undefined`?
- **V4 — member access through an absent value.** `{ a.b.c }` with `a.b` unset
  is nil in Sites and a thrown `TypeError` (a render error) in PuzzleKit. Is
  `?.` required in core, or does PuzzleKit guard plain access?
- **V5 — arithmetic and comparison on non-numbers.** `'2' * 3`, `null + 1`,
  `-'2'`, `1 < '2'`: JavaScript coerces; Sites yields nil. Should core define
  these as nil, or leave them undefined?
- **V6 — value printing. PuzzleKit follows the core** (see Interpolation and
  formatters). Sites still prints an object as `[object]` and a number at or
  above 1e21 (or below 1e-6) as plain digits instead of exponent form.
- **V7 — text units and Unicode.** `.length`, `truncate` and `size` count UTF-16
  units in PuzzleKit and runes in Sites, so emoji count 2 versus 1. Case mapping
  differs on special cases (`'ß' | upcase` is `SS` in PuzzleKit, `ß` in Sites),
  and the two whitespace sets `trim` removes differ on U+0085 and U+FEFF. Which
  unit and which Unicode tables are core?
- **V8 — object literals.** Sites accepts `{ height: 480 }`
  (`image_url(640, { height: 480 })`). PuzzleKit rejects an object literal at
  the start of an expression, and one inside a formatter argument compiles to
  invalid JavaScript (`{__d.height: 480}`) that only the bundler catches. Do
  object literals join the core?
- **V9 — list and object values in a brace-only attribute. PuzzleKit follows
  the core** (see Attributes); Sites already did. Listed until the shared
  conformance fixture pins both hosts.
- **V10 — whitespace edges.** PuzzleKit drops newline-bearing whitespace at
  every element edge; Sites drops it only at the first and last child of a
  parent. So `Hello` + newline + `<b>x</b>` + newline + `world` renders
  `Hello<b>x</b>world` in PuzzleKit and `Hello <b>x</b> world` in Sites.
  Sites also preserves `<pre>` and `<textarea>` bodies exactly, where PuzzleKit
  collapses them. And a newline-only gap between an interpolation and an
  `{#if}` keeps one space in PuzzleKit (D168) but is dropped in Sites. Which
  rule is core?
- **V11 — text inside `{#raw}`.** PuzzleKit creates a literal text node, so
  `{#raw}&amp;{/raw}` displays `&amp;`. Sites writes raw text unescaped, so the
  browser displays `&`. Is raw text subject to the "not entity-decoded" rule?
- **V12 — `{#for}` input outside its domain.** An absent collection runs zero
  times in Sites and throws in PuzzleKit. A string iterates its characters in
  PuzzleKit and runs zero times in Sites; a map warns in Sites. Non-integer
  range bounds truncate in PuzzleKit and warn and render nothing in Sites. What
  does core promise?
- **V13 — markers in exclusive branches. PuzzleKit follows the core** (see
  Slots): the check lives in the shared parser, so Sites follows it too at its
  next parser sync; it already allowed one marker per render path.
- **V14 — when is a slot "filled"? PuzzleKit follows the core** (see Slots).
  Sites still counts an empty `{#for}` and a call-site `{#if}` that renders
  nothing as filled, so its fallback stays hidden.
- **V15 — how a component reads its props.** Sites exposes each prop as a bare
  name (`{ tone }`). In PuzzleKit the same `{ tone }` reads a `data()` field,
  which is empty unless `data(params, props)` returns it. D172 records implicit
  props as a Sites addition, but a component file with no script is not
  portable between the hosts. Should core say how props reach a component's
  scope?
- **V16 — dotted component tags in Sites.** Family tags are core, and the
  shared parser accepts `<Frame.Wrapper>`. But a Sites component file name must
  match `^[A-Z][A-Za-z0-9]*$` in a flat `components/` folder, so no file can
  back a dotted tag. How does Sites map a dotted tag to a file?
- **V17 — formatter failure policy.** An unknown name or wrong argument count
  is a compile error in Sites; in PuzzleKit the value passes through unchanged
  with a development console error, and the argument count is never checked.
  Out-of-domain input (a string to `plus`, a non-list to `first` or `join`) is
  coerced or passed through in PuzzleKit, and warns and renders nothing in
  Sites. Is the failure policy per host (a restriction) or core?
- **V18 — scoped styles and `{#svg}` paths.** Both hosts accept
  `<style scoped>` with the same stamping algorithm but different prefixes and
  targets (PuzzleKit: `data-pzl-…` on the template root; Sites: `data-sites-…`
  on `<html>`, a section wrapper, or a component root). Sites also accepts an
  explicit `assets/` prefix in `{#svg}` paths, which PuzzleKit resolves as
  `app/assets/assets/…`. Should scoped styles and the `{#svg}` path rule be
  core?
