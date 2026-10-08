---
name: SPEC — template grammar, events, and composition
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
verified_at: '2026-07-25T05:53:18.357Z'
verified_sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
---

The contract for templates: the `@event` handler convention and modifiers, the template grammar, DOM islands, inline SVG, composition markers, list keying and row caching, cached handlers, accessibility warnings, raw blocks, snippets, component families and translations. The expression grammar's tables (literals, method table, globals, operators) are normative here by reference: [[DOC-LANGUAGE-CORE]] "Expressions" ([[DECISION-D176-EXPRESSION-LANGUAGE]]). See [[DOC-SPEC]] for the section index.

## 5. Event handler convention

Three forms, one rule each:

1. **Bare identifier** — `@click={ clearCompleted }` → invoked as `clearCompleted(event)`.
2. **Call expression** — `@click={ setFilter('all') }`, `@submit={ addTodo(event) }` → compiled to `(event) => setFilter('all')`, evaluated **at event time** with `event` in scope. The handler receives exactly the arguments written.
3. **Null-toggle ternary** — `@pointerdown:outside={ menuOpen ? closeMenu : null }` → each branch is form 1, form 2 or `null`; the test is evaluated at render time, and a `null` branch detaches the listener while the element stays mounted (§47). A bare `@click={ null }` emits no handler. Anything else — `@click={ a + b }`, `@click={ (e) => close(e) }`, `@click={ this.close }`, `@click={ handlers.close }` — is a positioned compile error.

The handler's own name resolves to the view's `events` entry, never to a library function; calls inside its arguments are ordinary expressions (§6). An empty event name (`@={ h }`, `@:prevent={ h }`) is a positioned error with no suggestion; a Vue-dotted name whose last segment is a modifier word (`@click.prevent`) is a positioned error with a did-you-mean (`@click:prevent`). A dotted name ending in anything else is a custom event and binds as written.

**`event` inside a handler** is the DOM event unless something binds that name — a `{#for}` item or counter, a `<Snippet>` parameter or an arrow parameter wins, and the compiler emits the DOM event as `__ev`. Outside a handler, `event` is an ordinary data read (`{ event.title }`, `<EventCard event={ item }>`, and `value={ event.title }` binds). A template that reads `event` as data (text, an attribute, a block header, a conditional handler's test) **and** uses the free `event` inside a handler is a positioned compile error at the handler's use, naming the data read ("`event` here is the DOM event, but this template also reads `event` as data at 2:9 — rename the field or prop"); passing `event={ item }` to a child is not a read. `puzzle check` reports the same error.

```html
<form @submit={ addTodo(event) }>
<input @keydown:enter={ addTodo(event) } />
<button @click={ deleteTodo(todo) }>×</button>
<button @click={ clearCompleted }>Clear</button>
```

```js
events = {
  addTodo: (event) => { event.preventDefault(); /* … */ },
  deleteTodo: (todo) => todo.destroy(),
  clearCompleted: () => { /* … */ },
};
```

A form control with a path-shaped `value=`/`checked=` needs no handler — it two-way binds (§6); an author `@input`/`@change` on the control suppresses the synthesis and owns the write.

### Event modifiers

`@event:modifier[:modifier…]={ handler }` adjusts dispatch declaratively. The handler stays a plain function; modifiers are encoded in the vnode key (`@keydown:enter:prevent`).

| Modifier | Effect | Applies to |
| --- | --- | --- |
| `prevent` | `event.preventDefault()` | any event |
| `stop` | `event.stopPropagation()` | any event |
| `once` | fires **once ever** for this binding; the spent marker survives per-patch handler swaps and clears only when the binding is removed | any event |
| `outside` | listener on **`document`, capture phase**; runs only when the target is **outside** the bound element (§47) | any event |
| `enter` `escape` `tab` `space` `up` `down` `left` `right` `backspace` `delete` | runs only when `event.key` is `Enter`/`Escape`/`Tab`/`' '`/`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Backspace`/`Delete` | `keydown`/`keyup`/`keypress` |

**Execution order is canonical, whatever the written order:** outside-gate → key-gate → once-spend → `preventDefault` → `stopPropagation` → handler. A gate that bails skips `preventDefault` (native behavior kept) and spends no `once`.

**Compile errors:** an unknown modifier, a key filter on a non-keyboard event, a duplicate modifier, more than one key filter, or any modifier on a **component callback prop** (D16).

## 6. Template grammar

- **Value printing (D127, D173 V6)** — one rule for every text position (bare interpolation, text run, quoted attribute `title="{ x }"`), in the browser and both prerender modes: `null`/`undefined` print nothing; numbers print by `Number::toString` (`1e21` → `1e+21`), `NaN`/±Infinity print nothing; booleans print `true`/`false` (a zero or false still renders — `??` semantics, never `||`); a list prints its items by this rule joined with `,`; any other object (record, plain object, `Date`, `URL`, Decimal/Temporal, anything with its own `toString`) prints nothing — format it (`date(v)`) or print a field. A function prints as `String` would; never interpolate one.
- **Brace-only attribute** (`data-x={ x }`) keeps DOM attribute semantics (D173 V9): `false`/`null`/`undefined` **omit** it (a quoted `data-x="{ x }"` writes it empty), `true` writes it empty, a list is a **token list** (items printed by the rule above, space-joined, with `false` and every item that prints nothing dropped — `class={ [active && 'on', 'btn'] }` writes `class="btn"`), an object omits it, anything else prints. A controlled `value={ … }` is a live property that prints the same way; a list passed as a component prop stays a list.
- **Development warnings:** an `undefined` value and an object in any position log one warning naming the expression (a brace-only DOM attribute names the attribute; a `Date` names `date()`/`datetime()`/`time()`). Absent from production.
- **Reading through a missing value (D173 V4).** Every member step, index step and method call compiles to its optional form — `{ user.profile.name }` → `__d.user?.profile?.name`, `{ rows[0].label }` → `__d.rows?.[0]?.label`, `{ note.trim() }` → `__d.note?.trim()` — so a missing link renders nothing (with the undefined warning) instead of throwing. `Object.keys`/`values`/`entries` receive `x ?? {}`, so a missing value yields `[]`. Writing `?.` is legal and unnecessary. Handler arguments are guarded the same way at fire time, except a chain rooted at the handler's free `event`, which compiles as written; a conditional handler's test is guarded at render time.
- **Expression boundary (D176).** A template expression is JavaScript's expression syntax closed by one grammar and a method table; the tables are [[DOC-LANGUAGE-CORE]] "Expressions". One parser (`packages/puzzle-lang/expr`) reads every position — text, attribute values, props, marker arguments, `key=`, `{#if}`/`{:else if}`/`{#unless}`/`{#case}`/`{:when}`, `{#for}` headers and `@event` values — and codegen lowers the tree (`compiler/internal/codegen/lower.go`); the `<script>` body is never parsed (§4). Callable: a **library function** by bare name, a **method** from the table on a string, list or number, and a **global** from the fixed list. The count is **`.length`** (UTF-16 units for strings); `.size` is an ordinary field read (`file.size`). `==`/`!=` are loose equality, unchanged (D173 V2); `x == null` is the portable absence test.
  - **Scope:** `data()` fields and props, `{#for}` items and counters, `<Snippet>` parameters, arrow parameters, and — inside a handler — the DOM `event`. Except in the `<Component>` `is` attribute (§67), a name imported or declared in `<script>` is **not** reachable: it compiles to a data read and evaluates `undefined`, and the compiler emits a positioned **warning** when a template reads a name `<script>` imports. A bound name is a value, so calling it (`t('key')` inside `{#for t in …}`) is an error.
  - **No view instance (D176 rule 7):** `this` is not an identifier in any template expression, handler arguments and tests included — a positioned error at the token ("`this` is not available in template expressions — return the value from data() (a getter or a computed field), or use a function for a display transform"); `this?.`, `(this)` and `this[…]` too. `x.this` is an ordinary member read. The one door into the view's JavaScript is an `@event` handler (§5), where a chain rooted at the free `event` skips the method table (`event.target.value`, `event.target.closest('li')`, `event.preventDefault()`).
  - **No browser globals:** `window`, `document` and `globalThis` as a data root are a positioned error ("`window` is the browser window, which template expressions cannot reach — read the value you need in data() and return it"); every other name, `location` and `localStorage` included, reads `data()`.
  - **Everything outside the grammar is a positioned compile error naming the replacement:** a method outside the table (`sort` → `toSorted()`, `push` → `concat()`, `substr` → `slice()`), `.length()`, `new`/`Date`, `JSON`, `typeof`, `instanceof`, `in`, `**` (`Math.pow`), regex literals, comments, `++`/`--`, assignment, the comma operator, spread, bitwise operators, and `??` mixed with `&&`/`||` without parentheses. With no regex literals, `/` after any operand is division (`{ café / 2 }`, `{ of / 2 }` close at their brace). **A `|` is the pipe steer** ("`| name` pipes were removed — write `name(value)`; bitwise OR is not available"), naming the JavaScript replacement when the name after it is a removed function (`| upcase` → `.toUpperCase()`).
  - **Object literals (D173 V8)** are legal as arguments and nested values — `{ t('cart.count', { count: n }) }`, `@click={ save({ id: todo.id }) }` — with identifier keys, quoted keys and shorthand (`{ count }` → `{ count: __d.count }`); computed keys, spread, methods and numeric keys are errors. One may not **start** an expression (`{ { a: 1 } }` is an error).
  - The idiom: compute in `data()`, render the result. PuzzleKit has no `{#let}` (Sites does).
- **Functions (D176 rule 4, D173 V1).** A display transform is a library function called value-first — `{ currency(price) }`, `{ truncate(capitalize(title), 40) }` — in every expression position. A function presents a value; it never duplicates an operator, a method or a `Math` global. **Resolution:** a bare call `name(…)` is the library, never data; a bare name is data, never a function. Inside `@event`, the outer call names the view's handler (§5); a handler named like a standard or PuzzleKit-only function draws a compile warning, and `events` shadowing a library name draws a development warning at mount. Apps register functions under the `formatters` config key (§2) and call them bare. A form value with a call (`value={ name.toUpperCase() }`) is one-way. Every library call feeds the D31 manifest scan.
  - **Purity (contract, D170):** a function must be a pure function of its arguments — a cached `{#for}` row does not re-run its calls. `timeago` (codegen's `clockFunctions`) makes its loop site re-evaluate every render; an app function is taken at its word. Clock- or ambient-dependent values are computed in `data()`.
  - **Unknown names (D43)** never crash: the call compiles to `(__f["name"] || __f.__missing("name"))(…)`, passes the value through unchanged, and logs one `console.error` per name (did-you-mean; the replacement for a removed name). It cannot be a compile error because app functions register at runtime; `puzzle check` types the standard functions' arguments and an app function as `(...args: any[]) => any` through `__puzzle_app_fn("name")(…)`, which passes `noUncheckedIndexedAccess`.
  - **Constant arguments:** a string-literal preset `date`/`time`/`datetime` does not know (`time(at, 'shrot')`), or a literal `in_timezone` zone that cannot be a zone id, is a positioned compile **warning** naming the valid presets (a warning, since an app may re-register those names). A dynamic unknown preset is a development error that renders the default. `in_timezone`: a zone `Intl` rejects renders un-shifted with a development error once per zone; `null`/`''` renders un-shifted silently; omitted is `'UTC'`.
  - **`link(path)` (D79)** turns a path into the mode's href via `router.url()` (§9): `/collections/1` in path mode (base-prefixed under `routerBase`), `#/collections/1` in hash mode, unchanged in memory mode. Registered by `PuzzleApp` at mount only if the app has no `link`; nullish → `''`, non-strings coerced, strings not starting with `/` pass through. Not in the D31 manifest.
  - **Calendar dates (D114):** a bare `YYYY-MM-DD` string is local midnight for the date family, so it displays as written in every zone; invalid components fall back to the raw value; the `iso` preset returns it unchanged; inputs with a time or zone are untouched.
- **The standard library (D174).** 19 functions shared with Sites (`STANDARD_FORMATTERS` in `client-runtime/formatters.js`) plus PuzzleKit-only `link` and `timeago`:
  - Numbers: `round(v, places = 0)` (half away from zero on the decimal value; negative places round to tens; returns a number), `currency(v, symbol = '$', places = 2)` (`-$1,234.50`), `percentage(v, places = 0)` (the number as written — a ratio is `percentage(ratio * 100)`), `number_with_delimiter(v, delimiter?)` (viewer locale unless given), `compact_number(v)` (`1.2K`).
  - Text: `capitalize(v)` (first character only), `truncate(v, length = 100, ellipsis = '…')` (code points; never longer than `length`), `strip_html(v)` (quote-aware; a bare `<` stays), `strip_newlines(v)` (CR and LF), `pluralize(n, singular, plural = singular + 's')` (locale-formatted count and word: `3 comments`).
  - Markup: `escape(v)` (identity on text), `raw`, `newline_to_br` (below). Values: `json(v)` (keys sorted by code point; missing and non-finite → `null`).
  - Dates: `date`, `time`, `datetime` take `(v, preset?, locale?)`, presets `short`/`medium`/`long` (Intl, viewer locale and zone) and `iso` (RFC 3339 in the viewer's zone); defaults are the medium date, the short time (`3:04 PM`), and medium date + short time; an unknown preset renders the default. `in_timezone(v, zone = 'UTC')` re-expresses an instant for those three.
  - Translation: `t(key, vars?)` (§66). PuzzleKit-only: `link(path)`, `timeago(v)` (reads the clock at render time).
  - **Prerendered pages format on the build machine:** static and hybrid output print `number_with_delimiter`, `pluralize`, `compact_number`, `date`, `time`, `datetime` and `timeago` in the build machine's locale (`LANG`, or `LC_ALL`; `i18n.defaultLocale` when translations are configured) and zone (`TZ`); the browser re-renders in the viewer's. Pin both for deterministic HTML.
  - **Removed names steer:** `upcase`/`downcase` → `.toUpperCase()`/`.toLowerCase()`, `trim`/`strip` → `.trim()`, `replace(a, b)` → `.replaceAll(a, b)`, `join` → `.join(', ')`, `split` → `.split()`, `abs`/`ceil`/`floor` → `Math.*`, `size` → `.length`, `plus`/`minus`/`times`/`divided_by`/`modulo` → operators, `default` → `??`, `sort`/`where`/`map`/`reverse`/`compact`/`first`/`last` → `.toSorted()`/`.filter()`/`.map()`/`.toReversed()`/`.filter(x => x != null)`/`.at(0)`/`.at(-1)`, `uniq` → `data()`, `noescape` → a plain `{ value }`. A call to one takes the unknown-name pass-through with a hint naming the replacement.
  - An app function under a standard name wins, with a development-only warning. The identical-output rows are pinned by `packages/puzzle-lang/conformance/functions.json`, which Sites' Go tests run too.
- **Markup functions: `raw` and `newline_to_br` (D174).** Every other interpolation renders a text node. `{ raw(html) }` injects HTML **through an allowlist sanitizer** (same code in the browser and both prerender modes): document markup survives (paragraphs, headings, lists, tables, `<b>`/`<i>`/`<em>`/`<strong>`/`<code>`/`<pre>`/`<blockquote>`/`<br>`, links, images) with `class`, `id`, `title`, `lang`, `dir` on any kept tag — `id` never on `<img>` and never starting with `__` — and `target` only as `_blank`, which always gets `rel="noopener noreferrer"`. `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>`/`<svg>`/`<math>`/`<template>`/`<noscript>` drop with their contents; other tags (forms, `<font>`, custom elements) unwrap to text; `on*`, `style`, `name`, any author `rel` and any other `target` are removed; `href`/`src`/`srcset` survive only relative or `http(s)` (`mailto:`/`tel:` on links), the scheme read after entity decoding and leading control/whitespace removal, every `srcset` token checked. Surviving `class`/`id` can use the app's CSS and shadow a global via `window[id]` — a UI-overlay/naming risk for untrusted HTML, not code execution. Output is balanced. `{ newline_to_br(text) }` escapes and emits a `<br>` per CR LF, CR or LF.
  - **Placement:** a markup function must be the outermost call of a **text** interpolation, with one argument. Wrapping it (`escape(raw(x))`, `raw(x).trim()`, `raw(x) + 'a'`), using it in any attribute value (the view root's included), a prop, a marker argument or an `{#if}`/`{#case}` subject, a second argument, inside a raw-text element (`<script>`, `<style>`, `<textarea>`, `<title>`, `<noscript>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`, `<plaintext>`), or inside foreign content (`<svg>` outside `<foreignObject>`, any `<math>`) is a positioned compile error. Component children and snippet bodies are checked in the surrounding element's context; only `<Portal>` starts fresh.
  - **Lowering:** such an interpolation becomes a live-HTML vnode (`new ViewNode('#html', { value })`) anchored by an empty comment, parsed through an inert `<template>`, replaced when the value changes and left untouched when it does not, moved and removed as a range, never reconciled inside. The registry is never consulted, so an app function named `raw` is unreachable from templates (development warning) and **app functions cannot inject markup**. The node is a non-text sibling for whitespace, has no wrapper, and cannot be a component root or a `{#for}` body root. Gated by `__PUZZLE_HAS_RAW_HTML__` and `__PUZZLE_HAS_RAW_SANITIZE__` (a `newline_to_br`-only app ships no sanitizer). The `raw` conformance rows pin the allowlist, including an XSS corpus that must come out inert.
- **Conditionals:** `{#if expr} … {:else if expr} … {:else} … {/if}`. Each condition is one expression (`{#if tags.length > 0}`); `{:else}` must be last; `else if` is desugared at parse time to nested `{#if}`. `{:elsif}`/`{:elseif}` get a did-you-mean error. Errors: an empty condition, `{:else if}` after `{:else}`, outside `{#if}`, inside `{#unless}`/`{#case}`, or in an attribute-value inline `{#if}` (flat `{#if}…{:else}` only).
- **`{#unless expr} … {:else} … {/unless}`** renders when `expr` is falsy; desugars to a negated `{#if}`. `{:else if}` inside it is an error suggesting an `{#if}` ladder.
- **`{#case expr}{:when v1, v2} … {:else} … {/case}`** — top-level commas in `{:when}` are OR; strict `===`; first match wins, no fallthrough; the subject is evaluated once. Errors: a missing subject, zero `{:when}`, non-whitespace before the first `{:when}`, a valueless `{:when}`, `{:when}` after `{:else}`, `{:else if}` in a case, a `{:when}` outside a case, unclosed or mismatched closers.
- **Loops:** `{#for item in items}` and `{#for 1...n}`; a trailing `, name` binds the counter (`{#for item in items, i}` — 0-based index; `{#for 1...n, x}` — the current number). The collection and bounds are expressions (`{#for t in todos.filter(t => !t.done)}`). `{#for i in 1...5}` is an error steering to `{#for 1...5, i}`. Rows are keyed automatically (§28). **Loop domain (D173 V12):** an array iterates; `null`/`undefined` loops zero times silently; any other non-list (string, object, number, Set) loops zero times with a development warning. Range bounds truncate toward zero, warning when a bound's numeric value is not an integer (a numeric string such as `'5'` is fine); a missing or non-finite bound, or an end below the start, runs zero times. Guards: `listRows` for a lowered site, `loopItems` (`__e`) for a `.map` site, `loopRange` (`__r(from, to)`) for a range, each imported only where emitted; a range with two integer-literal bounds is constant-folded.
- **Void elements:** `area base br col embed hr img input link meta source track wbr` end at their start tag (`<br>`, `<br/>`, `<br />` are identical). A closing tag for one is a positioned error at the closer ("`<input>` is a void element and has no closing tag — remove the `</input>`"). Only the lowercase names are void; the rule holds inside `{#raw}`; a `{#svg}` file body is never parsed. The prerender serializer writes void tags without end tags.
- **Attribute values:** interpolation and inline `{#if}` inside quoted values — `class="base {#if done}line-through{/if}"`. `\{` and `\}` are literal braces in text and quoted values.
- **Bindings:** `name={ expr }` on any attribute. **Implicit two-way binding (D147):** `value=`/`checked=` on a plain `<input>`/`<textarea>`/`<select>` binds when ALL hold: (1) a plain form control, never a component; (2) the expression is exactly `ident` or `ident.ident` — no calls, operators, brackets, `?.`, ternaries or deeper chains; keyword/global roots never classify, `event` classifies like any field; a bare loop variable does not, a loop-variable path (`todo.completed`) does; (3) no author `@input`/`@change` (any modifiers) — other events (`@keydown:enter`, `@blur`) do not suppress; (4) no static `readonly`/`disabled`; (5) `type` absent or a static classifiable string — dynamic `type` never binds, `checked` binds only with static `type="checkbox"`, `value` on a checkbox never binds, and `file`/`radio`/`submit`/`button`/`reset`/`image`/`hidden` and `<select multiple>` are excluded. The compiler emits `'@input:bind'`/`'@change:bind'` → `this.__bind(target, field, spec)`, a memoized handler (no `__h` site; identity stable wherever the target's is).
  - **Events and coercion:** text-ish inputs (no type, text, search, email, password, url, tel, color), `<textarea>` and `range` bind on `input`; `number`, `checkbox`, date/time kinds and `<select>` on `change` (numeric coercion mid-typing would rewrite `"1.20"` to `1.2` under the caret). Numeric writes: `''` → `null`, NaN skipped. Checkbox writes `!!checked`. An `input` with `event.isComposing` never writes; the final `input` after `compositionend` (with `isComposing` false) writes the composed text. State lags the DOM during IME composition, so an unrelated re-render mid-composition re-asserts the stale value.
  - **Write dispatch:** a bare identifier writes local state (`setData` + `refresh`, so `data()`-derived values stay live); a member path writes its root — a store record through validated `update()` (a rejection reports to `onError` with `phase: 'bind'`, mutates nothing, and leaves the typed text), a plain object is mutated and its owner repaints. A path whose root is missing is **inert** (the compiler passes `root ?? 0`; a primitive root never writes), so it never plants a stray top-level key. Everything else compiles as a one-way binding, silently (`value={ draft ?? '' }`). Escapes: an author handler, a non-path expression, static `readonly`. Taught rule: **bind the path you want written**; a constrained field binds a draft and commits with `record.update()` on submit. A dev diagnostic warns once per key when a `data()` commit reverts a bound local key.
- **Events:** `@event={ … }` per §5. **Callback props:** `@name={ handler }` on a **component tag** passes the wrapped handler as the prop `name`; the child reads it from `props` and calls it. DOM listeners belong to the child's own template (D16). There is no `$emit` or event bus.
- **Attribute spreads (D180):** `{...expr}` on a component invocation passes the expression's current own properties as props in written attribute order; later attributes or spreads override earlier ones. The operand uses normal template data scope and the existing leading-object-literal restriction: use a variable or parenthesized object literal. This attribute form does not permit spread inside an expression or object/array literal.
- **Components:** a tag whose name does not start with a lowercase ASCII letter is a component — `<UserProfile userId={ id } />`, `<Übersicht größe={ 3 } />` — imported in `<script>`. The name is a member path `Ident('.'Ident)*` of `$`-free JavaScript identifiers in any script; §65 has the grammar and errors. **Script-less components (D173 V15):** a component file with no `<script>` gets `data(params, props) { return props; }`, so `{ tone }` reads the prop; with a script, its own `data()` decides (views and layouts have no props).
- **Composition:** `<Children/>` renders call-site children, `<Slot/>` in a layout renders the routed view, `<Slot name="x">` renders `slot="x"` children (§24); **props for data, children for markup**.
- **DOM islands:** a bare static `island` attribute freezes an element's children after mount (§17).
- **Element refs:** a static `ref="name"` binds the node to `this.refs.name` (§38); `ref={ expr }` is a compile error.
- **Comments (D70):** `{## text }` (inline) and `{#comment} … {/comment}` (block; body discarded **raw**, so it can hold broken markup; nested blocks count). Erased at the lexer, legal at any text position including skeletons. Inline comments track `{`/`}` depth with `\{`/`\}` escapes and are not string-aware (`{## don't }` is fine); a lone `}` needs `\}`. The closer tolerates whitespace; opener content after the keyword is ignored. HTML comments are stripped at compile time. Errors: unclosed `{##`, unterminated `{#comment}`, either inside an attribute value, a stray `{/comment}`.
- **Text whitespace (D168, D173 V10):** text renders as the same markup renders in a browser, without source indentation. A whitespace run collapses to one space. Whitespace containing a newline is **dropped** at a parent's first/last-child edge (element, component children, marker fallback, snippet body, control-block body) and between two non-text siblings (elements, components, markers, `<Portal>`, `<Snippet>`, `{#svg}`, a markup interpolation, control blocks); between text or an interpolation and anything else it is **one space** (`{ first }` + newline + `{ last }` → `John Doe`), and a space next to a control block sits outside it. Nothing is invented where the source has no whitespace (`{ a }{ b }`). A **`<pre>`/`<textarea>` body is preserved exactly** except the newline right after the start tag; a `{#raw}` body keeps its leading newline; a `{#for}` body inside one still drops its own whitespace. The prerender serializer doubles a leading newline in those bodies. A leading/trailing space in a flex or grid item does not render.
- **Raw blocks:** `{#raw}…{/raw}` makes source braces literal (§57); unrelated to the `raw` function.

## 17. DOM islands

"This subtree's DOM is owned by someone else" (D44) — for always-on `contenteditable` surfaces and third-party mounts (maps, charts).

```html
<div contenteditable="true" island
     @input={ syncText(event) }
     @keydown:enter:prevent={ splitBlock(event) }>{ block.text }</div>
```

- **Mount:** the children render normally as **seed content** (full grammar).
- **Patch:** the element's own **attributes and listeners patch**; its **children are never reconciled** — the patcher carries the mounted child vnodes forward and leaves the DOM alone.
- **Identity:** keyed islands move intact. A **tag or key change replaces and re-seeds** — changing the key is the reset lever. Island-ness is part of identity: branches that agree on tag and key but disagree on `island` **replace** in both directions; ownership never crosses a patch.
- The attribute never reaches the DOM (stripped like `key`).
- **Compile errors:** `island={ expr }`; `island` on a component tag; a component or any composition marker inside an island subtree; `island` on the `<puzzle-view>` root.
- **One-way flow:** after mount, data flows **out** (events → store), never in. Listeners on seeded children are wired at mount and never swapped (call-expression arguments are frozen at mount-time values). A programmatic change must update both the DOM (imperatively) and the store. A controlled `contenteditable` binding is deliberately not offered — the browser restructures that DOM during editing.

## 18. Inline SVG assets: `{#svg}`

One SVG file on disk, inlined by name at **compile time** (D46).

```html
<button class="group text-gray-500 hover:text-red-500" @click={ toggleCart }>
  <span class="inline-block size-5">{#svg 'icons/cart.svg'}</span>
</button>
```

- **Grammar:** a **void block tag** — no `{/svg}` (a stray one is an error: "`{#svg}` is self-contained — remove the `{/svg}`"). The header is exactly one quoted **static string**; a non-literal path or anything after the path is an error. Legal anywhere an element is, including `{#if}`/`{#for}`/`{#case}` bodies, islands and skeletons.
- **Resolution:** from **`app/assets/`** only (`'icons/cart.svg'` → `app/assets/icons/cart.svg`). Absolute, `./`, `../`, escaping and backslash paths are errors. `app/assets/` is compile-time only, never copied (contrast `app/public/`). A missing file or folder, or a malformed file, is a positioned error (in the `.pzl` for path problems, in the `.svg` for file problems). `puzzle dev` watches inlined files, so editing or creating one rebuilds.
- **The file is inert:** the compiler skips a UTF-8 BOM, strips an XML prolog/DOCTYPE, requires a single `<svg>` root (nested `<svg>` is fine), lifts only the root's attributes onto a vnode, and embeds the inside as a **verbatim string** — never template-parsed. At runtime the root is a real SVG-namespace vnode whose string children are seeded once via `innerHTML` and then island-owned (zero diff cost). String vs array children are part of identity: a `{#svg}` and authored `<svg>` in one conditional position replace, never patch. For a reactive SVG, paste the markup into the template (any SVG compiles, `<text>` included — told apart from the text-node marker by the absence of a `value` attr).
- **Styling:** no per-use attributes (`{#svg 'p' class="…"}` is rejected). Use `currentColor` in the file, color classes on the parent, and a sized wrapper or `[&_svg]:size-5`. Liquid-style params (`{#svg 'path', class: '…'}`) stay a reserved future extension.
- **Cost:** each use embeds its own copy; a large SVG used often belongs in `app/public/` as `<img src>`.
- **Tooling:** `pzlc --assets <dir>` (default: the nearest ancestor `app` directory's `assets/`). `puzzle init` scaffolds `app/assets/icons/heart.svg`.

## 24. Composition markers: `<Children>`, `<Slot>`, `<Slot name>`

Two tags, three roles: **`<Children>`** is the default marker (call-site content), **`<Slot>`** is the router outlet (D30), **`<Slot name="x">`** is a named slot. Each is **self-closing** (no fallback) or **paired**, where the body is a fallback rendered only when nothing fills the position (D141) — not evaluated otherwise, so a filled position never runs its fallback's expressions or diagnostics; an empty paired body equals self-closing. A fallback is ordinary template content; a marker may not appear inside another marker's fallback. `Children`, `Slot`, `Snippet`, `Portal` and `Component` are reserved tag names, matched before component resolution. `<Component>` is a constructor selector (§67), whose children are forwarded default-slot content, not fallback content. The `<Children>` and `<Slot>` markers compile to one marker vnode carrying the fallback as a thunk (`fallback: () => [ … ]`), called at most once per marker vnode.

```html
<!-- Card.pzl -->
<puzzle-view>
  <article class="card">
    <header><Slot name="header"/></header>
    <div class="body"><Children>Nothing here yet</Children></div>
    <footer><Slot name="footer"/></footer>
  </article>
</puzzle-view>

<!-- call site -->
<Card>
  <h2 slot="header">{ post.title }</h2>
  <p>{ post.excerpt }</p>
  <Button slot="footer" @click={ open }>Read</Button>
</Card>
```

- **Filled (D173 V14):** a position is filled only when its supplied content **renders at least one node that is not whitespace-only text**. A false call-site `{#if}` or an empty `{#for}` leaves it unfilled, so the fallback shows (`<List>{#for item in items}…{/for}</List>` against `<Children>Nothing here yet</Children>`). An ordinary element or component fills. A `<Component>` selection range (§67) counts only its rendered children, so nullish selection leaves the enclosing slot unfilled. The rule is the same for the default marker, named slots and each snippet stamp (§64); a wrapper forwarding an unfilled position hands on its own fallback. A marker **without** a fallback passes content through as supplied, placeholders included, so toggling a call-site `{#if}` never moves later siblings. Hybrid and static prerender share the expansion.
- **Keep a fallback to one root element when siblings follow the marker.** Unkeyed children patch by position (§28), so a fallback whose node count differs from the content shifts and remounts every later sibling (an `<input>` loses focus). Wrap multi-node fallbacks or put the marker last; the runtime does not pad.
- **`<Children>`:** renders the untagged direct children (or, in a routed view/layout, the default bucket). Its only attributes are snippet arguments (§64); any other attribute is an error (`ref` gets the render-target message; a bare attribute steers to `<Snippet>`). No is-filled probe exists — the fallback body is the mechanism. **One default marker per render path**, counting `<Slot>` (D173 V13): the exclusive branches of one `{#if}`/`{:else if}`/`{:else}`, `{#unless}`/`{:else}` or `{#case}` are separate paths; a marker before or after that block, two in one branch, or markers in two separate `{#if}` blocks are a positioned error. A marker in a `{#for}` body is one declaration (the snippet N-stamp case); two in one loop body are an error.
- **`<Slot>`:** bare, the router outlet in shells and layouts. Its fallback renders when no child route occupies the outlet. Views and components share one format, so `<Slot>`-in-views vs `<Children>`-in-components is convention, not enforcement.
- **`<Slot name="x">`:** `name` is static, non-empty and unique per render path; `default` and `children` are reserved (they steer to `<Children/>`). Renders the call-site children tagged `slot="x"`. Every other valued attribute is a snippet argument (§64).
- **Lowercase spellings:** any `<children…>` or `<slot…>` is a positioned error steering to the capitalized form; a lowercase `<snippet …fits>` steers too; a plain `<template>` is ordinary HTML.
- **Call site:** a **static** `slot="x"` on a **direct child** (element or component) routes it and is stripped from output; other direct children form the default content. Errors: dynamic `slot={expr}` on a direct child; a control-flow block at direct-child level containing top-level `slot`-attributed elements (put the condition inside the slotted element). Elsewhere `slot` is the ordinary HTML attribute.
- **Views/layouts:** the router fills only the DEFAULT bucket; a named slot in a routed template renders its fallback (or nothing).
- **Forwarding (D71):** a default marker **inside a component invocation** forwards the enclosing template's default content — `<Card><Children/></Card>` in a layout hands the routed page to Card's default slot (`<Slot/>` there is the same node). The expansion substitutes the enclosing markers before the inner component expands; a routed vnode's pinned instance rides along. An unfilled enclosing position forwards its own fallback, or nothing. Only the default marker forwards: `<Slot name="x"/>` inside an invocation is a positioned error, enforced through nested elements, control flow and deeper invocations. Forwarding carries the caller's **snippets** too, unmodified and uninvoked, transitively (§64).

## 28. List keying and row caching

- **Auto-key is primary-key-aware (D58).** An item-form `{#for}` body root gets `key: ViewNode.keyOf(item)`: a store record keys by its model's `primaryKey()` field, anything else by `.id`. `keyOf` is internal surface.
- **Explicit key:** `key={ … }` on the body root (element or component, item or range form) **replaces** the synthetic key verbatim (`keyOf` not applied). Keys must be stable and unique. On a component row root, the resolved synthetic or explicit row key is emitted after props and spreads, so a spread cannot override the row's identity.
- **Null keys warn** once, naming the item shape, and the list degrades to positional diffing; duplicate keys warn separately. Range loops key by the generated number.

**Row state and caching (D170).** An item-form `{#for}` keeps one **row state per key** while the site shows that key: the item, the index, the record's stored render revision, the live scope object its handlers close over, the last rendered vnode subtree, static-subtree caches and nested loop blocks. On a parent render the site returns the **same vnode subtree** for an unchanged row, and the patcher skips it. A row changes when:

- **Records** — a different reference, or an advanced **render revision** (the store's notification sequence for that record's last observable mutation: `createRecord`, `update()`, `removeRecord`, adapter upserts, save reconciliation).
- **Plain objects and arrays** — always (they mutate in place unobserved). Primitives compare by value.
- **The index** — only when the body reads the counter.
- **A parent `data()` root the body reads** (`selectedId === todo.id`) changed this render; an object-valued root counts as changed every render.
- **An unanalysable body** — it calls a clock-reading function (`timeago`, codegen's `clockFunctions`; app functions are pure by contract, §6) or reads an **enclosing loop's item or counter** (every loop between reader and owner re-evaluates with the outer row). Or a **conservative** site: the body reads a relation, a computed getter, or any path deeper than one level off the item — a revision covers only the record's own fields — checked once per model class against its schema and relationship names. Neither `this` nor browser globals can be row inputs (§6).
- **An opaque read of the item.** The item rides on identity only where the compiler sees what is read: a direct member access (`{ todo.text }`, `todo?.text`) or a whole-value read that is the whole expression (`{ todo }`, `todo={ todo }`, a handler argument). Passing it to a function, into a method's arguments, calling a method on it or a path off it (`todo.text.trim()`), using it as an operand, in a template literal, or in an array/object literal makes the site conservative.

Handler **arguments** are exempt from all of this except that a parent root they read joins the site's dirty mask (§31): they evaluate at fire time against the live row.

Contract rules:

- **A record mutated by direct field assignment (`todo.title = 'x'`) is not observed** — no revision, no notification. Mutate through `update()` or a store path.
- **Duplicate and null keys within one pass are uncached** (both rows build fresh; development warns once).

Keyed-list behavior is otherwise unchanged: shared sibling key namespace, mixed keyed/unkeyed pairing, leaving rows and out animations, FLIP (§46), and controlled form values re-asserted against the live DOM every pass. **Not cached:** a range `{#for}`, a loop inside a `<Snippet>` body, and an item loop whose explicit `key=` reads render state (kept as `.map`) — nor anything nested inside one of those.

## 31. Cached event handlers

An `@event` site whose handler is **data-independent** — the bare form, or a call whose arguments read nothing from the render beyond the DOM `event` (literals, `event` chains, arrow parameters, allowed globals like `Math.*`, all evaluated at fire time) — compiles to a per-instance cached closure (D62):

```js
'@click': ((this.__h ??= {})[3] ??= (event) => this.events.h(event))
```

The `this.events` lookup still happens at fire time; what changes is **identity** — the same function on every render. So component callback props compare equal across parent renders (a child with static, cached or memoized props does not re-run `data()`, per §4), and DOM listeners at cached sites do not rebind per patch (`:once` state lives on the element). A call that captures render data — a data root (`save(draft)` → `__d.draft`) or a library call (`save(date(when))` → `__f`) — stays a fresh closure, and a child receiving it re-runs `data()` per parent render (correctly).

**Loop handlers cache on the row (D170).** Inside an item-form `{#for}`, a handler whose arguments capture only that loop's locals rewrites them to the row's live scope and caches there:

```js
remove: (s.h0 ??= (event) => this.events.deleteTodo(s.item)),
```

`h0` counts from 0 per site; `s.item` is the row's *current* item, so one function serves every render of the row and stays right after updates, reorders and same-key replacement. Handlers reading a data root or calling a library function stay fresh, and the roots they read join the site's dirty mask. Closures over a **range** variable or a `<Snippet>` parameter stay fresh (re-created per iteration or expansion).

Site numbering is per file and deterministic (`render()` and `renderSkeleton()` share the counter). `this.__h` is reserved on instances; row-scope caches live on the row state (§4).

## 43. Compiler accessibility warnings

**Positioned, non-fatal warnings** (never errors) on the out-of-band diagnostics channel; generated JavaScript is identical whether or not a template warns (D82).

- Rules: `<img>` without `alt`; `<input type="image">` (static type) without `alt`; `<iframe>` without `title`; `<a>` without `href`; a statically positive `tabindex`.
- `alt=""` is valid. An attribute is **present** when any static, valueless, dynamic or mixed attribute carries the name; a dynamic `type`/`tabindex` never warns.
- The template and `<puzzle-skeleton>` are scanned, including `{#if}`/`{#for}`/`{#case}` bodies, component children and marker fallbacks.
- No suppression syntax, warning IDs, ARIA role matrix or click/keyboard heuristics — additions are SPEC amendments.

## 47. The `outside` event modifier: `@event:outside`

`@click:outside={ close }` — declarative outside-dismiss on any event (D86): `@pointerdown:outside` dismisses on press, `@focusin:outside` detects focus leaving a widget.

- **Placement:** the listener attaches to **`document` in the capture phase**; the handler runs only when `el.contains(event.target)` is false. Capture means an unrelated `stopPropagation()` cannot swallow the event, and the interaction that opens a panel cannot dismiss it in the same dispatch (a panel mounted mid-event attaches after the capture phase passed).
- **Gate order:** first in §5's order — an inside event spends no `once` and prevents nothing.
- **Lifecycle:** the framework attaches on mount and detaches on every removal (conditional toggle, keyed-row removal, subtree teardown, view destroy) and on the null toggle (`@pointerdown:outside={ open ? close : null }`). Idiomatic: the binding on the panel root inside `{#if open}`; the always-mounted alternative is the null toggle.
- `@click` and `@click:outside` on one element are independent. `outside` on a component callback prop is rejected like every modifier.
- **Limitations:** events inside an `<iframe>` never reach the parent document; on touch, `pointerdown` fires at scroll start — prefer `@click:outside` where scrolling matters.

## 57. Raw template blocks: `{#raw}…{/raw}`

`{#raw}` disables the brace lexer for its body (D150) — for JSON, JavaScript, CSS and code samples.

```html
<script type="application/json" data-tarot-options>
  {#raw}{ "loop": true, "slidesPerView": 3 }{/raw}
</script>

<pre>{#raw}const shape = { a: 1, b: [2, 3] };{/raw}</pre>
```

- Every `{`/`}` in the body is literal: interpolations, blocks, branches, closers and brace-valued event bindings do nothing.
- HTML stays structural: `{#raw}<b>hi</b>{/raw}` emits a real `<b>`. Attributes inside are static; `@click={ handler }` is a literal attribute. Void elements close at their start tag.
- A brace-valued attribute keeps its bytes verbatim, but the scan for its closing `}` is JS-lexically aware (strings, template literals, regex literals, comments), so `data-json={ {"text": "}"} }` survives; an unbalanced quote swallows the closer and is a positioned error. The scan only finds the boundary; the bytes get no meaning.
- No nesting; the first tolerant closer (`{/raw}`, `{/ raw }`, `{/raw }`) wins, so a literal `{/raw}` cannot appear in the body. Content after the opener keyword is ignored.
- **The section splitter steps over the block** with the lexer's own scanner, so splitter and lexer agree on its end: braces, quotes and `//` cannot carry the scan into `<script>`, and a literal section close tag inside is text (`<pre>{#raw}<puzzle-view>…</puzzle-view>{/raw}</pre>` compiles). When a `{#raw}` has no `{/raw}` in its own section, the first close tag inside the skipped span is kept as a fallback, used only when no close tag follows the span, so the lexer reports the unterminated block at its opener.
- Legal at text positions, including skeletons. A raw opener inside an attribute value is an error; an unterminated block errors at its opening brace.
- The body is static source — no expression, no runtime value. An unsanitized `{@html expr}` stays deferred; the `raw` function is the sanitized value-level path.

Client rendering creates literal text nodes. Prerendering entity-escapes ordinary element text; `<script>`/`<style>` use §36's RAWTEXT policy, and a JSON-typed script rewrites `<` to its unicode escape, so `JSON.parse(el.textContent)` still works and no closing tag can break out.

## 64. Snippets: `<Snippet>` + marker arguments

Slots render a passed-in template; **snippets render it repeatedly, with data** ([[DECISION-D166-SNIPPETS]]). A `<Snippet>` is a caller-declared body with parameters; the component stamps it per item through its own marker.

```html
<!-- caller -->
<UserList users={ users }>
  <Snippet user><img src={ user.avatar } /> <b>{ user.name }</b></Snippet>
</UserList>

<GroupedList groups={ groups }>
  <Snippet fits="heading" group>{ group.title }</Snippet>
  <Snippet fits="row" user group>…</Snippet>
</GroupedList>

<!-- component -->
{#for user in users}
  <li key={ user.id }><Children user={ user }>{ user.name }</Children></li>
{/for}
<Slot name="row" user={ user } group={ group }>fallback…</Slot>
```

- **Grammar:** `<Snippet>` is **paired-only** (self-closing is an error) and legal **only as a direct child of a component invocation** (the `slot="x"` position rule, including the control-flow rejection). `fits="x"` (static, non-empty) routes it to `<Slot name="x">`; omitted, it fills `<Children>`. **Every other attribute is bare and declares a parameter**; a valued parameter, an `@event` or a dynamic attribute steers to the bare form. Parameter names are valid identifiers, unique, not `fits`.
- **Marker side:** on `<Children>` and `<Slot name="x">`, every valued attribute except `name` is a per-stamp **argument**, evaluated in the component's scope every render. A bare attribute on a marker steers to `<Snippet>`; `@event` on markers stays rejected.
- **Binding by name:** argument names feed parameter names (the files compile separately); declaring a subset is legal. Parameters shadow caller fields and enclosing `{#for}` variables; the rest of the caller's scope stays visible.
- **Fallbacks:** a paired marker's body still renders when nothing fills it, so adding an argument-bearing marker breaks no caller. A stamp fills only when it renders a non-whitespace node (§24), so `{#if user.admin}…{/if}` shows the fallback where false. Plain content filling an argument-bearing marker renders the fallback and warns in development.
- **Uniqueness:** at most one snippet per `fits` name per invocation (`default` included); a snippet and a `slot="x"` element may not target the same name; a default snippet may not coexist with plain default content. §24's per-render-path rule applies (one marker in `{#for}` is the N-stamp case). Argument-bearing markers stay rejected inside islands.
- **A snippet body is a composition LEAF:** `<Children>`, `<Slot>` and `<Snippet>` are errors anywhere inside it, at any depth, including a `<Snippet>` on a component invocation inside the body. Components and `<Portal>` are legal (a marker inside that portal is still rejected). Nest by extraction into a component. `ref=` is rejected there (§38). §24's nested-fallback restriction does not apply.
- **Semantics:** a snippet compiles to a function carried in the invocation's **children**, not its props (it closes over caller render data, so as a prop it would defeat §31's shallow compare). Each stamp calls it and gets fresh vnodes, patched through keyed reconciliation. A component re-render re-invokes; a caller re-render uses the slot-only update path. Both prerender modes share the expansion; a prepared takeover tree expands once.
- **Forwarding:** a bare `<Children/>` inside a nested invocation forwards the caller's snippets with the default content (`DatePicker` rendering `<Calendar …><Children/></Calendar>` hands a `<Snippet fits="day">` to Calendar's `day` marker), transitively; an argument-bearing marker stamps locally and never forwards; a wrapper may do both. A snippet nothing stamps is never invoked.
- **Development diagnostics:** parameter/argument mismatch, plain content in an argument-bearing marker, and a snippet output containing a marker — once per component and position. No "unused snippet" diagnostic.
- **Cost:** gated by `__PUZZLE_HAS_SNIPPETS__` (D89) — zero bytes for an app without snippets or marker arguments.

## 65. Component families: dotted component tags

Related components import as one unit and invoke with dot notation ([[DECISION-D167-COMPONENT-FAMILIES]]).

```html
<script>import Frame from '@/components/Frame';</script>

<Frame><Frame.Wrapper><Frame.Content>…</Frame.Content></Frame.Wrapper></Frame>
```

- **Which tags are components:** a tag whose first character is not ASCII `a`–`z` (the only characters that begin an HTML element name) — `<Card>`, `<Übersicht>`, `<概要>`, `<Frame.Übersicht>`, `<ärmel>`, `<_foo>`; `<straße-karte>` is a custom element. The lexer reads tag names with JavaScript identifier rules past ASCII (`jsident.IsIDStart`/`IsIDContinue`, shared with expressions and the compiler's `<script>` scan): an ASCII letter, `_` or non-ASCII `ID_Start`, then ASCII letters, digits, `_`, `-`, `:`, `.` or non-ASCII `ID_Continue`. `$` is never part of a tag name (`<$50` is text); `<` directly before a letter of any script opens a tag, so `値<上限` in text is an error like `a<b`.
- **Tag-name grammar:** a component tag that survives marker resolution must be `Ident('.'Ident)*`, each segment a `$`-free JavaScript identifier; `<Frame-x>`, `<Frame:Wrapper>`, `<Frame.>`, `<Frame.٣x>` are positioned errors. A dotted name rooted at a built-in name (`<Slot.Foo>`, `<Component.Foo>`) steers. The check skips `{#raw}` and lowercase tags (custom elements and namespaced SVG are untouched). Attribute and prop names may use any script (`<Card größe={ 3 }>`). The compiler also errors where its `<script>` scan cannot read a Unicode class name to its end.
- **Resolution is lexical:** the tag is emitted verbatim as a member expression (`new ViewNode(Frame.Wrapper, …)`) and resolves against module scope like `<Frame>`. No registry; the compiler never reads imports.
- **The family is a convention:** `.pzl` stays one class per file; a family is a directory of members plus a plain JS `index.js` barrel:

```js
export default Object.assign(Frame, { Wrapper, Content });
export { Frame, Wrapper, Content };
```

so both `import Frame from '@/components/Frame'` and `import { Wrapper } from '@/components/Frame'` work. `puzzle generate component Frame --family Wrapper,Content` (§13) scaffolds the directory, a stub per member and the barrel: members are PascalCase-validated, unique, not the root, not marker names; `--family` on another kind is an error; all-or-nothing, and `--force` rewrites only the family's files. Family stubs are composition-shaped (`<Children/>` plus a caller `class` override).

## 66. Translations: the `t` function and `ctx.i18n`

The contract; rationale and rejected alternatives are in [[DECISION-D175-TRANSLATIONS]], the build side in [[DOC-SPEC-BUILD]], the switch rebuild in [[DOC-SPEC-ROUTER]].

- **Opt-in by config:** `puzzle.config.js` `i18n: { locales: ['en', 'es'], defaultLocale: 'en' }` (§11). Without it nothing ships (`__PUZZLE_HAS_I18N__` is a config fact), and `ctx.i18n`/`app.i18n` do not exist.
- **Locale files:** one `app/locales/<tag>.json` per locale, BCP 47 with `-` (`pt_BR.json` is a build error suggesting `pt-BR`). Nesting flattens to dotted keys; a flat file with dotted keys is equivalent. An object whose keys are ALL CLDR categories (`zero`, `one`, `two`, `few`, `many`, `other`) is a plural entry and must have `other`; any other object is a namespace. Values are strings, namespaces or plural entries; anything else, a duplicate flattened key, or a plural without `other` is a positioned build error. An empty object is a build warning.
- **`{ t(key) }` / `{ t(key, { … }) }`:** one of the 19 standard functions, registered by the i18n service; usable in every expression position.
  - The key is looked up in the active locale's table (already filled from the default locale by the build). A miss prints the key, with a development warning once per key and locale (did-you-mean). A literal key the default locale lacks is a build warning.
  - `null`/`undefined` input prints nothing; other input is stringified (`t('status.' + order.status)` works).
  - Variables are ONE object — a literal or any object (a store record). `{name}` placeholders fill in one left-to-right pass (inserted text is never re-substituted); the name is the exact text between braces; it is found on the object or its class chain (computed getters, relationships), never `Object.prototype`. An unfound name stays as written; a nullish value prints nothing; values print by §6. An unclosed `{` is literal. Non-object variables are ignored with a development warning.
  - **Plurals:** with a numeric `count`, a plural entry picks its form by `Intl.PluralRules(locale).select(count)` (cached per locale), falling back to `other`; **an exact `count` of 0 uses `zero` when present**, in every locale. A plural used without `count` renders `other` with a development warning. `{count}` prints in the locale's number format only when `count` is a finite number (otherwise it prints by §6, like every other variable); other variables print unformatted.
  - Output is text; markup prints literally.
- **The service:** `this.ctx.i18n` / `app.i18n` carry `t(key, vars?)`, `locale`, `locales` (config order), `defaultLocale` and `setLocale(tag)`. `t` is registered at mount only if the app has none (an app `t` wins, with the standard-name warning). Without `i18n`, a template `t` hits the D43 guard, whose hint names the `i18n` config, and the build warns (an app's own `t` is fine; the compiler cannot see app.js).
- **Display locale:** with `i18n`, the active locale replaces the viewer's in `date`, `time`, `datetime`, `number_with_delimiter`, `compact_number`, the `pluralize` count and `timeago`; an explicit `locale` argument still wins and `currency` stays locale-independent. One slot per page (two apps share it; last switch wins). Prerendered pages use the default locale. A tag `Intl` rejects never throws during render: display and plural selection fall back to the viewer's locale.
- **Startup selection:** (1) stored `localStorage.__puzzleLocale` (try/catch; only if still configured); (2) each of `navigator.languages` — exact tag (case-insensitive), then its base (`es-CO` → `es`), then the first configured tag with that base (`pt` → `pt-BR`); (3) `defaultLocale`. Prerender always uses `defaultLocale`.
- **Loading:** `mount()` starts the fetch while wiring services and awaits it after `beforeMount`, before the HMR restore and `router.start()`, so navigation zero never renders without strings. A prerendered page's matching inline table (`script[data-puzzle-locale]`) needs no request. A failed load falls back once to the default; if that fails, `mount()` rejects through the `beforeMount` teardown. A `t` call before strings arrive prints the key with a development warning.
- **`setLocale(tag)`:** an unconfigured tag throws a `RangeError` naming the locales (every build). Otherwise the file is fetched first; then the table, `locale`, display locale and `<html lang>` switch together, the choice is stored, and the page rebuilds once at the same location; the promise resolves when that rebuild commits. A navigation still loading (push, `replace()`, pop, an earlier rebuild) finishes first and the page it commits is rebuilt; the promise resolves once the new strings are active, so `await ctx.i18n.setLocale(user.locale)` in a layout's `data()` or a guard is safe. The already-active locale changes and rebuilds nothing (unless the last rebuild into it failed: then it retries). A failed fetch rejects and changes nothing. A failed rebuild (reported through `onError`) rejects and leaves the old page with the new locale active; calling again retries, and the next navigation rebuilds every level. A rebuild waiting behind a navigation reports failure through `onError` only. Overlapping calls resolve last-wins (an overtaken call settles with the later outcome). In `beforeMount` it replaces the pending startup load and rebuilds nothing; during navigation zero (a layout's `data()` or a guard) the first navigation lands and is then rebuilt, like any navigation still loading. Store records survive a switch; `setData` state does not. Static output re-assembles its page chain (nothing animates in) and swaps it in once mounted; a mount that throws keeps the old page and rejects.
- **`<html lang>`** is the default locale in prerendered pages (the build rewrites the shell) and the active locale at runtime, except in memory mode, which never touches the document.
- **Not built:** translated route `meta.title` (static by §45), locale URL prefixes, rich-text translations, `dir="rtl"`, key types for `puzzle check`.

## 67. Runtime component selection: `<Component>`

A built-in slot selects from a finite set of compiled Puzzle components already imported by the caller ([[DECISION-D180-COMPONENT-SLOT]]). It adds no global registry, lazy manifest or string-to-module resolution.

```html
<script>
import TaskCard from './TaskCard.pzl';
import BacktestCard from './BacktestCard.pzl';
const cards = { task: TaskCard, backtest: BacktestCard };
</script>

<Component is={ current } title={ title } @close={ close }>
  <p>Default content for the selected component</p>
</Component>

<Component is={ cards[embed.type] } {...embed.props} />
```

- **Selection:** the required `is={ expression }` evaluates to an imported compiled Puzzle component constructor. `null` or `undefined` renders nothing, including none of this tag's children. Any other non-component value is an error. Children forward as ordinary default-slot content.
- **Selector scope:** only `is` may read module-scope imports and simple declared bindings from `<script>` directly (`is={ TaskCard }`, `is={ cards[key] }`). The conservative script scan recognizes simple declarations, including subsequent `const`/`let`/`var` declarators; destructured bindings need a simple module alias or exposure through `data()`. Loop/snippet/arrow bindings take precedence, then module bindings, then ordinary `data()`/prop fields. Every other prop, spread operand and child expression uses normal template scope. Expressions still obey §6's closed grammar; `is` does not permit arbitrary script calls.
- **Row caching:** imports and `const` selector bindings retain normal cached-row behavior (§28); mutating entries of a const map in place is not observed by a cached row. A selector read of a module `let`/`var` binding makes enclosing cached loop sites volatile so each parent render re-evaluates the selection.
- **Props and events:** every non-selector attribute is handled as on a normal component invocation: reactive props, callback props (`onclose={ closeCallback }` or `@close={ close }`) and ordered `{...props}` spreads. A loop row's key wins over any key in a spread. `name` and `from` are ordinary forwarded props, with ordinary data scope. A stable constructor reuses its instance and patches props. Component `bind:` remains a positioned reserved-namespace error (§6 / D147).
- **Swaps:** changing the selected constructor tears down the outgoing instance and descendants completely before mounting the incoming one in the same stable position. Subscriptions/effects, DOM listeners and refs belong to the outgoing instance and are released. The new instance receives current props; a constructor change never retains the previous component's local state. Nested `<Component>` slots follow the same rule. Only a constructor change uses immediate teardown and bypasses hide hooks and leave transitions; removing the slot itself runs the chosen child's normal hide/leave path.
- **Ranges:** a component with `<Component>` as its template root occupies the whole start/end-comment range, recursively through nested component roots. Keyed moves, conditional replacements and error recovery preserve that range's position and boundaries.
- **Errors:** missing, valueless, string, number, boolean, template-literal or duplicate `is` is a positioned compile error, including those non-component literals written inside braces. Nullish selectors remain valid. `flip` on `<Component>` is a positioned compile error; animate a real keyed element instead. A spread cannot supply the required selector; `name`/`from` without `is` fails for missing `is`. `Component` is reserved as a tag and family root; a `Component.pzl` user component, an imported binding used as `<Component>`, or `<Component.Member>` gets a clear rename hint.
- **Prerender:** both output modes apply the same selection, props and default-slot rules and serialize the selected component's HTML, or nothing for nullish selection. The stable range emits no visible wrapper. This is a PuzzleKit dialect feature.
