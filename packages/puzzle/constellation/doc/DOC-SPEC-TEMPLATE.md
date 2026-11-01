---
name: SPEC — template grammar, events, and composition
kind: reference
status: verified
connections:
  - DOC-SPEC
  - DOC-LANGUAGE-CORE
  - COMPONENT-TEMPLATE-PARSER
  - COMPONENT-CODEGEN
  - COMPONENT-VIEW-MANAGER
  - DECISION-D176-EXPRESSION-LANGUAGE
  - DECISION-D186-DYNAMIC-URL-SAFETY
  - DECISION-D144-PORTAL
verified_at: '2026-11-01T19:25:25.008Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

The contract for templates: the `@event` handler convention and modifiers, the template grammar, DOM islands, inline SVG, composition markers and `<Portal>`, list keying and row caching, cached handlers, accessibility warnings, raw blocks, snippets, component families, translations and `<Component>`. The expression grammar's tables (literals, method table, globals, operators) are normative here by reference: [[DOC-LANGUAGE-CORE]] "Expressions" ([[DECISION-D176-EXPRESSION-LANGUAGE]]). [[DOC-SPEC]] has the section index.

## 5. Event handler convention

Three forms, one rule each:

1. **Bare identifier** — `@click={ clearCompleted }` → invoked as `clearCompleted(event)`.
2. **Call expression** — `@click={ setFilter('all') }`, `@submit={ addTodo(event) }` → compiled to `(event) => setFilter('all')`, evaluated **at event time** with `event` in scope. The handler receives exactly the arguments written.
3. **Null-toggle ternary** — `@pointerdown:outside={ menuOpen ? closeMenu : null }` → each branch is form 1, form 2 or `null`; the test is evaluated at render time, and a `null` branch detaches the listener while the element stays mounted (§47). A bare `@click={ null }` emits no handler. Anything else — `@click={ a + b }`, `@click={ (e) => close(e) }`, `@click={ this.close }`, `@click={ handlers.close }` — is a positioned compile error.

The handler's own name resolves to the view's `events` entry, never to a library function; calls inside its arguments are ordinary expressions (§6). An empty event name (`@={ h }`, `@:prevent={ h }`) is a positioned error. A Vue-dotted name whose last segment is a modifier word (`@click.prevent`) is a positioned error suggesting `@click:prevent`; a dotted name ending in anything else is a custom event and binds as written.

**`event` inside a handler** is the DOM event unless something binds that name — a `{#for}` item or counter, a `<Snippet>` parameter or an arrow parameter wins, and the compiler emits the DOM event as `__ev`. Outside a handler, `event` is an ordinary data read (`{ event.title }`, `<EventCard event={ item }>`). A template that reads `event` as data (text, an attribute, a block header, a conditional handler's test) **and** uses the free `event` inside a handler is a positioned compile error at the handler's use, naming the data read's position ("`event` here is the DOM event, but this template also reads `event` as data at 2:9 — rename the field or prop"). Passing `event={ item }` to a child is not a read. `puzzle check` reports the same error.

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
| `passive` | native listener option `passive: true` ([[DECISION-D187-PASSIVE-CAPTURE]]) | any event |
| `capture` | native listener option `capture: true`; removal uses the same flag | any event |
| `enter` `escape` `tab` `space` `up` `down` `left` `right` `backspace` `delete` | runs only when `event.key` is `Enter`/`Escape`/`Tab`/`' '`/`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Backspace`/`Delete` | `keydown`/`keyup`/`keypress` |

**Execution order is fixed, whatever the written order:** outside-gate → key-gate → once-spend → `preventDefault` → `stopPropagation` → handler. A gate that bails skips `preventDefault` (native behavior kept) and spends no `once`. `passive` and `capture` change only how the listener is installed; `outside` is always capture and may also be passive.

**Compile errors:** an unknown modifier, a key filter on a non-keyboard event, a duplicate modifier, more than one key filter, `passive` with `prevent`, or any modifier on a **component callback prop** (D16).

## 6. Template grammar

### Values and attributes

- **Value printing (D173 V6)** — one rule for every text position (bare interpolation, text run, quoted attribute `title="{ x }"`), in the browser and both prerender modes: `null`/`undefined` print nothing; numbers print by `Number::toString` (`1e21` → `1e+21`), `NaN`/±Infinity print nothing; booleans print `true`/`false` (a `0` or `false` still renders — `??` semantics, never `||`); a list prints its items by this rule joined with `,`; any other object (record, plain object, `Date`, `URL`, anything with its own `toString`) prints nothing — format it (`date(v)`) or print a field. Never interpolate a function.
- **Brace-only attribute** (`data-x={ x }`, D173 V9) keeps DOM attribute semantics: `false`/`null`/`undefined` **omit** it (a quoted `data-x="{ x }"` writes it empty), `true` writes it empty, a list is a **token list** (items printed by the rule above, space-joined, `false` and every item that prints nothing dropped — `class={ [active && 'on', 'btn'] }` writes `class="btn"`), an object omits it, anything else prints. A controlled `value={ … }` is a live property that prints the same way; a list passed as a component prop stays a list.
- **Dynamic URL attributes ([[DECISION-D186-DYNAMIC-URL-SAFETY]]).** A brace-only or mixed value on a URL attribute of a DOM element (`href`, `src`, `action`, `srcset`, … — the full list is in the decision) is checked: `javascript:` and `vbscript:` are blocked everywhere, `data:` outside image positions; a list attribute is blocked whole when any entry is unsafe. A blocked value omits the attribute, in the browser and prerendered HTML alike, with a development warning. Static attributes, `{#raw}` markup and `{#svg}` files are trusted source; a mixed value whose literal head already fixes the scheme (`href="/users/{ id }"`, `href="mailto:{ email }"`) compiles without the check. Component props are not checked — the child's own DOM binding is. A dynamic `srcdoc` on `<iframe>` is a positioned compile error unless the iframe carries a static `sandbox` without `allow-scripts` (and no other `sandbox` attribute).
- **Development warnings:** an `undefined` value and an object in any position log one warning naming the expression (a brace-only DOM attribute names the attribute; a `Date` names `date()`/`datetime()`/`time()`). Absent from production.
- **Attribute values:** interpolation and inline `{#if}` inside quoted values — `class="base {#if done}line-through{/if}"`. `\{` and `\}` are literal braces in text and quoted values.
- **Reserved names:** an attribute name containing `:` is a positioned error except the `xml:`, `xlink:` and `xmlns:` namespaces. A binding-shaped prefix (`bind:value`, `v-model:`) steers to implicit binding (below); any other (`inkscape:label`) steers to stripping the attribute or loading the file with `{#svg}`.

### Expressions

- **Reading through a missing value (D173 V4).** Every member step, index step and method call compiles to its optional form — `{ user.profile.name }` → `__d.user?.profile?.name`, `{ rows[0].label }` → `__d.rows?.[0]?.label`, `{ note.trim() }` → `__d.note?.trim()` — so a missing link renders nothing (with the undefined warning) instead of throwing. `Object.keys`/`values`/`entries` receive `x ?? {}`, so a missing value yields `[]`. Writing `?.` is legal and unnecessary. Handler arguments are guarded the same way at fire time, except a chain rooted at the handler's free `event`, which compiles as written; a conditional handler's test is guarded at render time.
- **Expression boundary (D176).** A template expression is JavaScript's expression syntax closed by one grammar and a method table ([[DOC-LANGUAGE-CORE]] "Expressions"). One parser (`packages/puzzle-lang/expr`) reads every position — text, attribute values, props, marker arguments, `key=`, `{#if}`/`{:else if}`/`{#unless}`/`{#case}`/`{:when}`, `{#for}` headers and `@event` values — and codegen lowers the tree (`compiler/internal/codegen/lower.go`); the `<script>` body is never parsed (§4). Callable: a **library function** by bare name, a **method** from the table on a string, list or number, and a **global** from the fixed list. The count is **`.length`** (UTF-16 units for strings); `.size` is an ordinary field read (`file.size`). `==`/`!=` are loose equality (D173 V2); `x == null` is the portable absence test.
  - **Scope:** `data()` fields and props, `{#for}` items and counters, `<Snippet>` parameters, arrow parameters, and — inside a handler — the DOM `event`. Except in the `<Component>` `is` attribute (§67), a name imported or declared in `<script>` is **not** reachable: it compiles to a data read and evaluates `undefined`, and the compiler warns (positioned) when a template reads a name `<script>` imports. A bound name is a value, so calling it (`t('key')` inside `{#for t in …}`) is an error.
  - **No view instance:** `this` is not an identifier in any template expression, handler arguments and tests included — a positioned error at the token ("`this` is not available in template expressions — return the value from data() (a getter or a computed field), or use a function for a display transform"); `this?.`, `(this)` and `this[…]` too. `x.this` is an ordinary member read. The one door into the view's JavaScript is an `@event` handler (§5), where a chain rooted at the free `event` skips the method table (`event.target.value`, `event.target.closest('li')`, `event.preventDefault()`).
  - **No browser globals:** `window`, `document` and `globalThis` as a data root are a positioned error ("`window` is the browser window, which template expressions cannot reach — read the value you need in data() and return it"); every other name, `location` and `localStorage` included, reads `data()`.
  - **Everything outside the grammar is a positioned compile error naming the replacement:** a method outside the table (`sort` → `toSorted()`, `push` → `concat()`, `substr` → `slice()`), `.length()`, `new`/`Date`, `JSON`, `typeof`, `instanceof`, `in`, `**` (`Math.pow`), regex literals, comments, `++`/`--`, assignment, the comma operator, spread, bitwise operators, and `??` mixed with `&&`/`||` without parentheses. With no regex literals, `/` after any operand is division (`{ café / 2 }` closes at its brace). **`|` pipes are Sites syntax**: in a Puzzle app a `|` is the error "`| name` pipes are Sites theme syntax — in a Puzzle app write `name(value)`", naming the JavaScript replacement when the name after it is a removed function (`| upcase` → `.toUpperCase()`).
  - **Object literals (D173 V8)** are legal as arguments and nested values — `{ t('cart.count', { count: n }) }`, `@click={ save({ id: todo.id }) }` — with identifier keys, quoted keys and shorthand (`{ count }` → `{ count: __d.count }`); computed keys, spread, methods and numeric keys are errors. One may not **start** an expression (`{ { a: 1 } }` is an error).
  - The idiom: compute in `data()`, render the result. PuzzleKit has no `{#let}` (Sites does).

### Functions

- **Calling (D176, D173 V1).** A display transform is a library function called value-first — `{ currency(price) }`, `{ truncate(capitalize(title), 40) }` — in every expression position. A function presents a value; it never duplicates an operator, a method or a `Math` global. **Resolution:** a bare call `name(…)` is the library, never data; a bare name is data, never a function. Inside `@event`, the outer call names the view's handler (§5); a handler named like a standard or PuzzleKit-only function draws a compile warning, and `events` shadowing a library name draws a development warning at mount. Apps register functions under the `formatters` config key (§2) and call them bare; an app function under a standard name wins, with a development warning. A form value with a call (`value={ name.toUpperCase() }`) is one-way. Every library call feeds the D31 manifest scan.
  - **Purity (contract, D170):** a function must be a pure function of its arguments — a cached `{#for}` row does not re-run its calls. `timeago` (codegen's `clockFunctions`) makes its loop site re-evaluate every render; an app function is taken at its word. Clock- or ambient-dependent values are computed in `data()`.
  - **Unknown names (D43)** never crash: the call compiles to `(__f["name"] || __f.__missing("name"))(…)`, passes the value through unchanged, and logs one `console.error` per name with a did-you-mean. It cannot be a compile error because app functions register at runtime; `puzzle check` types the standard functions' arguments (§63). A **removed name** (`upcase`, `join`, `size`, `default`, `sort`, `noescape`, … — `REMOVED_FORMATTERS` in `client-runtime/formatters.js`) takes the same pass-through, with a hint naming its method, operator or `??` replacement.
  - **Constant arguments:** a string-literal preset `date`/`time`/`datetime` does not know (`time(at, 'shrot')`), or a literal `in_timezone` zone that cannot be a zone id, is a positioned compile **warning** naming the valid presets (a warning, since an app may re-register those names). A dynamic unknown preset is a development error that renders the default. `in_timezone`: a zone `Intl` rejects renders un-shifted with a development error once per zone; `null`/`''` renders un-shifted silently; omitted is `'UTC'`.
  - **`link(path, options?)` (D79)** turns a path into the mode's href via `router.url()` (§9): `/collections/1` in path mode (prefixed with `routerBase`, and with the locale under locale prefix routing), `#/collections/1` in hash mode, unchanged in memory mode. `{ locale: 'es' }` forces one locale's prefix; `{ locale: false }` skips it and keeps the base (a file that exists once). Registered by `PuzzleApp` at mount only if the app has no `link`; nullish → `''`, non-strings coerced, strings not starting with `/` pass through. Not in the D31 manifest.
  - **Calendar dates (D114):** a bare `YYYY-MM-DD` string is local midnight for the date family, so it displays as written in every zone; invalid components fall back to the raw value; the `iso` preset returns it unchanged; inputs with a time or zone are untouched.
- **The standard library (D174).** 19 functions shared with Sites (`STANDARD_FORMATTERS` in `client-runtime/formatters.js`) plus PuzzleKit-only `link` and `timeago`. The identical-output rows are pinned by `packages/puzzle-lang/conformance/functions.json`, which Sites' Go tests run too.
  - Numbers: `round(v, places = 0)` (half away from zero on the decimal value; negative places round to tens; returns a number), `currency(v, symbol = '$', places = 2)` (`-$1,234.50`), `percentage(v, places = 0)` (the number as written — a ratio is `percentage(ratio * 100)`), `number_with_delimiter(v, delimiter?)` (viewer locale unless given), `compact_number(v)` (`1.2K`).
  - Text: `capitalize(v)` (first character only), `truncate(v, length = 100, ellipsis = '…')` (code points; never longer than `length`), `strip_html(v)` (quote-aware; a bare `<` stays), `strip_newlines(v)` (CR and LF), `pluralize(n, singular, plural = singular + 's')` (locale-formatted count and word: `3 comments`).
  - Markup: `escape(v)` (identity on text), `raw`, `newline_to_br` (below). Values: `json(v)` (keys sorted by code point; missing and non-finite → `null`).
  - Dates: `date`, `time`, `datetime` take `(v, preset?, locale?)`, presets `short`/`medium`/`long` (Intl, viewer locale and zone) and `iso` (RFC 3339 in the viewer's zone); defaults are the medium date, the short time (`3:04 PM`), and medium date + short time; an unknown preset renders the default. `in_timezone(v, zone = 'UTC')` re-expresses an instant for those three.
  - Translation: `t(key, vars?)` (§66). PuzzleKit-only: `link(path)`, `timeago(v)` (reads the clock at render time).
  - **Prerendered pages format on the build machine:** static and hybrid output print `number_with_delimiter`, `pluralize`, `compact_number`, `date`, `time`, `datetime` and `timeago` in the build machine's locale (`LANG`, or `LC_ALL`; the page's locale when translations are configured) and zone (`TZ`); the browser re-renders in the viewer's. Pin both for deterministic HTML.
- **Markup functions: `raw` and `newline_to_br` (D174).** Every other interpolation renders a text node; there is no unsanitized injection syntax. `{ raw(html) }` injects HTML **through an allowlist sanitizer** (`client-runtime/sanitize.js`, shared by the browser and both prerender modes):
  - Kept: document markup (paragraphs, headings, lists, tables, `<b>`/`<i>`/`<em>`/`<strong>`/`<code>`/`<pre>`/`<blockquote>`/`<br>`, links, images) with `class`, `id`, `title`, `lang`, `dir` on any kept tag — `id` never on `<img>` and never starting with `__` — and `target` only as `_blank`, which always gets `rel="noopener noreferrer"`. `href`/`src`/`srcset` survive only relative or `http(s)` (`mailto:`/`tel:` on links), the scheme read after entity decoding and leading control/whitespace removal, every `srcset` token checked. Output is balanced.
  - Dropped with contents: `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>`/`<svg>`/`<math>`/`<template>`/`<noscript>`. Other tags (forms, `<font>`, custom elements) unwrap to text. `on*`, `style`, `name`, any author `rel` and any other `target` are removed.
  - Surviving `class`/`id` can use the app's CSS and shadow a global via `window[id]` — a UI-overlay/naming risk for untrusted HTML, not code execution. The `raw` conformance rows pin the allowlist, including an XSS corpus that must come out inert.
  - `{ newline_to_br(text) }` escapes and emits a `<br>` per CR LF, CR or LF.
  - **Placement:** a markup function must be the outermost call of a **text** interpolation, with one argument. Wrapping it (`escape(raw(x))`, `raw(x).trim()`, `raw(x) + 'a'`), using it in any attribute value (the view root's included), a prop, a marker argument or an `{#if}`/`{#case}` subject, a second argument, inside a raw-text element (`<script>`, `<style>`, `<textarea>`, `<title>`, `<noscript>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`, `<plaintext>`), or inside foreign content (`<svg>` outside `<foreignObject>`, any `<math>`) is a positioned compile error. Component children and snippet bodies are checked in the surrounding element's context; only `<Portal>` starts fresh.
  - **Rendering:** the result is a live-HTML range (`new ViewNode('#html', { value })`, anchored by an empty comment) replaced when the value changes and never reconciled inside. It bypasses the function registry, so an app function named `raw` is unreachable from templates (development warning) and **app functions cannot inject markup**. It is a non-text sibling for whitespace and cannot be a component root or a `{#for}` body root. Gated by `__PUZZLE_HAS_RAW_HTML__` and `__PUZZLE_HAS_RAW_SANITIZE__` (a `newline_to_br`-only app ships no sanitizer).

### Blocks

- **Conditionals:** `{#if expr} … {:else if expr} … {:else} … {/if}`. Each condition is one expression (`{#if tags.length > 0}`); `{:else}` must be last; `else if` desugars at parse time to nested `{#if}`. `{:elsif}`/`{:elseif}` get a did-you-mean error. Errors: an empty condition, `{:else if}` after `{:else}`, outside `{#if}`, inside `{#unless}`/`{#case}`, or in an attribute-value inline `{#if}` (flat `{#if}…{:else}` only).
- **`{#unless expr} … {:else} … {/unless}`** renders when `expr` is falsy; desugars to a negated `{#if}`. `{:else if}` inside it is an error suggesting an `{#if}` ladder.
- **`{#case expr}{:when v1, v2} … {:else} … {/case}`** — top-level commas in `{:when}` are OR; strict `===`; first match wins, no fallthrough; the subject is evaluated once. Errors: a missing subject, zero `{:when}`, non-whitespace before the first `{:when}`, a valueless `{:when}`, `{:when}` after `{:else}`, `{:else if}` in a case, a `{:when}` outside a case, unclosed or mismatched closers.
- **Loops:** `{#for item in items}` and `{#for 1...n}`; a trailing `, name` binds the counter (`{#for item in items, i}` — 0-based index; `{#for 1...n, x}` — the current number). The collection and bounds are expressions (`{#for t in todos.filter(t => !t.done)}`). `{#for i in 1...5}` is an error steering to `{#for 1...5, i}`. Rows are keyed automatically (§28). **Loop domain (D173 V12):** an array iterates; `null`/`undefined` loops zero times silently; any other non-list (string, object, number, Set) loops zero times with a development warning. Range bounds truncate toward zero, warning when a bound's numeric value is not an integer (a numeric string such as `'5'` is fine); a missing or non-finite bound, or an end below the start, runs zero times. Guards: `listRows` (`__l`) for a lowered site, `loopItems` (`__e`) for a `.map` site, `loopRange` (`__r(from, to)`) for a range, each imported only where emitted; a range with two integer-literal bounds is constant-folded.
- **Comments (D70):** `{## text }` (inline) and `{#comment} … {/comment}` (block; body discarded **raw**, so it can hold broken markup; nested blocks count). Erased at the lexer, legal at any text position including skeletons. Inline comments track `{`/`}` depth with `\{`/`\}` escapes and are not string-aware (`{## don't }` is fine); a lone `}` needs `\}`. The closer tolerates whitespace; opener content after the keyword is ignored. HTML comments are stripped at compile time. Errors: unclosed `{##`, unterminated `{#comment}`, either inside an attribute value, a stray `{/comment}`.
- **Raw blocks:** `{#raw}…{/raw}` makes source braces literal (§57); unrelated to the `raw` function.

### Elements, bindings and composition

- **Void elements:** `area base br col embed hr img input link meta source track wbr` end at their start tag (`<br>`, `<br/>`, `<br />` are identical). A closing tag for one is a positioned error at the closer ("`<input>` is a void element and has no closing tag — remove the `</input>`"). Only the lowercase names are void; the rule holds inside `{#raw}`; a `{#svg}` file body is never parsed. The prerender serializer writes void tags without end tags.
- **Bindings:** `name={ expr }` on any attribute. **Implicit two-way binding (D147):** `value=`/`checked=` on a plain `<input>`/`<textarea>`/`<select>` binds when ALL hold: (1) a plain form control, never a component; (2) the expression is exactly `ident` or `ident.ident` — no calls, operators, brackets, `?.`, ternaries or deeper chains; keyword/global roots never classify, `event` classifies like any field; a bare loop variable does not, a loop-variable path (`todo.completed`) does; (3) no author `@input`/`@change` (any modifiers) — other events (`@keydown:enter`, `@blur`) do not suppress; (4) no static `readonly`/`disabled`; (5) `type` absent or a static classifiable string — dynamic `type` never binds, `checked` binds only with static `type="checkbox"`, `value` on a checkbox never binds, and `file`/`radio`/`submit`/`button`/`reset`/`image`/`hidden` and `<select multiple>` are excluded. The compiler emits `'@input:bind'`/`'@change:bind'` → `this.__bind(target, field, spec)`, a memoized handler (no `__h` site; identity stable wherever the target's is).
  - **Events and coercion:** text-ish inputs (no type, text, search, email, password, url, tel, color), `<textarea>` and `range` bind on `input`; `number`, `checkbox`, date/time kinds and `<select>` on `change` (numeric coercion mid-typing would rewrite `"1.20"` to `1.2` under the caret). Numeric writes: `''` → `null`, NaN skipped. Checkbox writes `!!checked`. An `input` with `event.isComposing` never writes; the final `input` after `compositionend` writes the composed text. State lags the DOM during IME composition, so an unrelated re-render mid-composition re-asserts the stale value.
  - **Write dispatch:** a bare identifier writes local state (`setData` + `refresh`, so `data()`-derived values stay live); a member path writes its root — a store record through validated `update()` (a rejection reports to `onError` with `phase: 'bind'`, mutates nothing, and leaves the typed text), a plain object is mutated and its owner repaints. A path whose root is missing is **inert** (the compiler passes `root ?? 0`; a primitive root never writes), so it never plants a stray top-level key. Everything else compiles as a one-way binding, silently (`value={ draft ?? '' }`). Rule: **bind the path you want written**; a constrained field binds a draft and commits with `record.update()` on submit. A development diagnostic warns once per key when a `data()` commit reverts a bound local key.
- **Events:** `@event={ … }` per §5. **Callback props:** `@name={ handler }` on a **component tag** passes the wrapped handler as the prop `name`; the child reads it from `props` and calls it. DOM listeners belong to the child's own template (D16). There is no `$emit` or event bus.
- **Attribute spreads (D180):** `{...expr}` on a component invocation passes the expression's current own properties as props in written attribute order; later attributes or spreads override earlier ones. The operand uses normal data scope and the leading-object-literal restriction (a variable or a parenthesized object literal). Elements and composition markers take no spread (positioned error).
- **Components:** a tag whose name does not start with a lowercase ASCII letter is a component — `<UserProfile userId={ id } />`, `<Übersicht größe={ 3 } />` — imported in `<script>`. The name is a member path `Ident('.'Ident)*` of `$`-free JavaScript identifiers in any script; §65 has the grammar and errors. **Script-less components (D173 V15):** a component file with no `<script>` gets `data(params, props) { return props; }`, so `{ tone }` reads the prop; with a script, its own `data()` decides (views and layouts have no props).
- **Composition:** `<Children/>` renders call-site children, `<Slot/>` in a layout renders the routed view, `<Slot name="x">` renders `slot="x"` children (§24); **props for data, children for markup**.
- **DOM islands:** a bare static `island` attribute freezes an element's children after mount (§17).
- **Element refs:** a static `ref="name"` binds the node to `this.refs.name` (§38); `ref={ expr }` is a compile error.
- **Text whitespace (D168, D173 V10):** text renders as the same markup renders in a browser, without source indentation. A whitespace run collapses to one space. Whitespace containing a newline is **dropped** at a parent's first/last-child edge (element, component children, marker fallback, snippet body, control-block body) and between two non-text siblings (elements, components, markers, `<Portal>`, `<Snippet>`, `{#svg}`, a markup interpolation, control blocks); between text or an interpolation and anything else it is **one space** (`{ first }` + newline + `{ last }` → `John Doe`), and a space next to a control block sits outside it. Nothing is invented where the source has no whitespace (`{ a }{ b }`). A **`<pre>`/`<textarea>` body is preserved exactly** except the newline right after the start tag; a `{#raw}` body keeps its leading newline; a `{#for}` body inside one still drops its own whitespace. The prerender serializer doubles a leading newline in those bodies. A leading/trailing space in a flex or grid item does not render.

## 17. DOM islands

"This subtree's DOM is owned by someone else" (D44) — for always-on `contenteditable` surfaces and third-party mounts (maps, charts).

```html
<div contenteditable="true" island
     @input={ syncText(event) }
     @keydown:enter:prevent={ splitBlock(event) }>{ block.text }</div>
```

- **Mount:** the children render normally as **seed content** (full grammar).
- **Patch:** the element's own **attributes and listeners patch**; its **children are never reconciled** — the patcher carries the mounted child vnodes forward and leaves the DOM alone.
- **Identity:** keyed islands move intact. A **tag or key change replaces and re-seeds** — changing the key is the reset lever. Island-ness is part of identity: branches that agree on tag and key but disagree on `island` **replace** in both directions.
- The attribute never reaches the DOM (stripped like `key`).
- **Compile errors:** `island={ expr }`; `island` on a component tag; a component, `<Portal>` or any composition marker inside an island subtree; `island` on the `<puzzle-view>` root.
- **One-way flow:** after mount, data flows **out** (events → store), never in. Listeners on seeded children are wired at mount and never swapped (call-expression arguments are frozen at mount-time values). A programmatic change must update both the DOM (imperatively) and the store. A controlled `contenteditable` binding is deliberately not offered — the browser restructures that DOM during editing.

## 18. Inline SVG assets: `{#svg}`

One SVG file on disk, inlined by name at **compile time** (D46).

```html
<button class="group text-gray-500 hover:text-red-500" @click={ toggleCart }>
  <span class="inline-block size-5">{#svg 'icons/cart.svg'}</span>
</button>
```

- **Grammar:** a **void block tag** — no `{/svg}` (a stray one is an error: "`{#svg}` is self-contained — remove the `{/svg}`"). The header is exactly one quoted **static string**; a non-literal path or anything after the path is an error ("`{#svg}` takes only a path — style the icon via its parent element"). Legal anywhere an element is, including `{#if}`/`{#for}`/`{#case}` bodies, islands and skeletons.
- **Resolution:** from **`app/assets/`** only (`'icons/cart.svg'` → `app/assets/icons/cart.svg`). Absolute, `./`, `../`, escaping and backslash paths are errors. `app/assets/` is compile-time only, never copied (contrast `app/public/`). A missing file or folder, or a malformed file, is a positioned error (in the `.pzl` for path problems, in the `.svg` for file problems). `puzzle dev` watches inlined files, so editing or creating one rebuilds.
- **The file is inert:** the compiler skips a UTF-8 BOM, strips an XML prolog/DOCTYPE, requires a single `<svg>` root (nested `<svg>` is fine), lifts only the root's attributes onto a vnode, and embeds the inside as a **verbatim string** — never template-parsed. At runtime the root is a real SVG-namespace vnode whose string children are seeded once via `innerHTML` and then island-owned (zero diff cost). String vs array children are part of identity: a `{#svg}` and authored `<svg>` in one conditional position replace, never patch. For a reactive SVG, paste the markup into the template (any SVG compiles, `<text>` included).
- **Styling:** no per-use attributes. Use `currentColor` in the file, color classes on the parent, and a sized wrapper or `[&_svg]:size-5`.
- **Cost:** each use embeds its own copy; a large SVG used often belongs in `app/public/` as `<img src>`.
- **Tooling:** `pzlc --assets <dir>` (default: the nearest ancestor `app` directory's `assets/`). `puzzle init` scaffolds `app/assets/icons/heart.svg`.

## 24. Composition markers: `<Children>`, `<Slot>`, `<Slot name>`

Two tags, three roles: **`<Children>`** is the default marker (call-site content), **`<Slot>`** is the router outlet (D30), **`<Slot name="x">`** is a named slot. Each is **self-closing** (no fallback) or **paired**, where the body is a fallback rendered only when nothing fills the position (D141) — not evaluated otherwise, so a filled position never runs its fallback's expressions or diagnostics; an empty paired body equals self-closing. The fallback compiles to a thunk on the marker vnode, called at most once per marker vnode. A fallback is ordinary template content; a marker may not appear inside another marker's fallback. `Children`, `Slot`, `Snippet`, `Portal` and `Component` are reserved tag names, matched before component resolution. `<Component>` (§67) is a constructor selector whose children are forwarded default-slot content, not a fallback.

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

- **Filled (D173 V14):** a position is filled only when its supplied content **renders at least one node that is not whitespace-only text**. A false call-site `{#if}` or an empty `{#for}` leaves it unfilled, so the fallback shows (`<List>{#for item in items}…{/for}</List>` against `<Children>Nothing here yet</Children>`). An ordinary element or component fills. A `<Component>` selection range (§67) counts only its rendered children, so a nullish selection leaves the enclosing slot unfilled. The rule is the same for the default marker, named slots and each snippet stamp (§64); a wrapper forwarding an unfilled position hands on its own fallback. A marker **without** a fallback passes content through as supplied, placeholders included, so toggling a call-site `{#if}` never moves later siblings. Hybrid and static prerender share the expansion.
- **Keep a fallback to one root element when siblings follow the marker.** Unkeyed children patch by position (§28), so a fallback whose node count differs from the content shifts and remounts every later sibling (an `<input>` loses focus). Wrap multi-node fallbacks or put the marker last; the runtime does not pad.
- **`<Children>`:** renders the untagged direct children (or, in a routed view/layout, the default bucket). Its only attributes are snippet arguments (§64); any other attribute is an error (`ref` gets the render-target message; a bare attribute steers to `<Snippet>`). There is no is-filled probe — the fallback body is the mechanism. **One default marker per render path**, counting `<Slot>` (D173 V13): the exclusive branches of one `{#if}`/`{:else if}`/`{:else}`, `{#unless}`/`{:else}` or `{#case}` are separate paths; a marker before or after that block, two in one branch, or markers in two separate `{#if}` blocks are a positioned error. A marker in a `{#for}` body is one declaration (the snippet N-stamp case); two in one loop body are an error.
- **`<Slot>`:** bare, the router outlet in shells and layouts. Its fallback renders when no child route occupies the outlet. Views and components share one format, so `<Slot>`-in-views vs `<Children>`-in-components is convention, not enforcement.
- **`<Slot name="x">`:** `name` is static, non-empty and unique per render path; `default` and `children` are reserved (they steer to `<Children/>`). Renders the call-site children tagged `slot="x"`. Every other valued attribute is a snippet argument (§64).
- **Lowercase spellings:** `<children>`, `<slot>` and `<portal>` are positioned errors steering to the capitalized form, and so is a lowercase `<snippet>` carrying `fits` or a bare attribute; a plain `<template>` is ordinary HTML.
- **Call site:** a **static** `slot="x"` on a **direct child** (element or component) routes it and is stripped from output; other direct children form the default content. Errors: dynamic `slot={expr}` on a direct child; a control-flow block at direct-child level containing top-level `slot`-attributed elements (put the condition inside the slotted element). Elsewhere `slot` is the ordinary HTML attribute.
- **Views/layouts:** the router fills only the default bucket; a named slot in a routed template renders its fallback (or nothing).
- **Forwarding (D71):** a default marker **inside a component invocation** forwards the enclosing template's default content — `<Card><Children/></Card>` in a layout hands the routed page to Card's default slot (`<Slot/>` there is the same node). The expansion substitutes the enclosing markers before the inner component expands; a routed vnode's pinned instance rides along. An unfilled enclosing position forwards its own fallback, or nothing. Only the default marker forwards: `<Slot name="x"/>` inside an invocation is a positioned error, enforced through nested elements, control flow and deeper invocations. Forwarding carries the caller's **snippets** too, unmodified and uninvoked, transitively (§64).

### `<Portal>`

`<Portal>…</Portal>` moves its children's DOM to one framework outlet at the app root while the subtree stays in the owner's component tree — same props, data flow, lifecycle and teardown ([[DECISION-D144-PORTAL]]). For overlays that must escape ancestor `transform`/`overflow`/stacking contexts; `<dialog>.showModal()` stays the tool for focus-trapped modals.

- **Grammar:** paired-only; no attributes (`to`/`name` are reserved for named outlets, `ref` is rejected). Positioned errors: `<Portal/>`, any attribute, inside a marker fallback, inside an island, and as a **component** template root (wrap it in `<div style="display: contents">`; a portal-only view is legal). Portal-in-portal is allowed.
- **Runtime:** one outlet, `<div data-puzzle-portal>`, appended beside the app's mount container, created on first portal mount and removed when the last one unmounts. The portal keeps a comment placeholder in place. `@event:outside` treats portaled content as inside its owner (§47). Gated by `__PUZZLE_HAS_PORTAL__` (D89).

## 28. List keying and row caching

- **Auto-key is primary-key-aware (D58).** An item-form `{#for}` body root gets `key: ViewNode.keyOf(item)`: a store record keys by its model's `primaryKey()` field, anything else by `.id`. `keyOf` is internal surface.
- **Explicit key:** `key={ … }` on the body root (element or component, item or range form) **replaces** the synthetic key verbatim (`keyOf` not applied). Keys must be stable and unique. On a component row root, the resolved synthetic or explicit row key is emitted after props and spreads, so a spread cannot override the row's identity.
- **Null keys warn** once, naming the item shape, and the list degrades to positional diffing; duplicate keys warn separately. Range loops key by the generated number.

**Row state and caching (D170).** An item-form `{#for}` keeps one **row state per key** while the site shows that key: the item, the index, the record's stored render revision, the live scope object its handlers close over, the last rendered vnode subtree, static-subtree caches and nested loop blocks. On a parent render the site returns the **same vnode subtree** for an unchanged row, and the patcher skips it. A row changes when:

- **Records** — a different reference, or an advanced **render revision** (the store's notification sequence for that record's last observable mutation: `createRecord`, `update()`, `removeRecord`, adapter upserts, save reconciliation).
- **Plain objects and arrays** — always (they mutate in place unobserved). Primitives compare by value.
- **The index** — only when the body reads the counter.
- **A parent `data()` root the body reads** (`selectedId === todo.id`) changed this render; an object-valued root counts as changed every render.
- **An unanalysable body** — it calls a clock-reading function (`timeago`; app functions are pure by contract, §6) or reads an **enclosing loop's item or counter** (every loop between reader and owner re-evaluates with the outer row). Or a **conservative** site: the body reads a relation, a computed getter, or any path deeper than one level off the item — a revision covers only the record's own fields — checked once per model class against its schema and relationship names.
- **An opaque read of the item.** The item rides on identity only where the compiler sees what is read: a direct member access (`{ todo.text }`, `todo?.text`) or a whole-value read that is the whole expression (`{ todo }`, `todo={ todo }`, a handler argument). Passing it to a function, into a method's arguments, calling a method on it or a path off it (`todo.text.trim()`), using it as an operand, in a template literal, or in an array/object literal makes the site conservative.

Handler **arguments** are exempt, except that a parent root they read joins the site's dirty mask (§31): they evaluate at fire time against the live row.

Contract rules:

- **A record mutated by direct field assignment (`todo.title = 'x'`) is not observed** — no revision, no notification. Mutate through `update()` or a store path.
- **Duplicate and null keys within one pass are uncached** (both rows build fresh; development warns once).

Keyed-list behavior is otherwise plain keyed reconciliation: shared sibling key namespace, mixed keyed/unkeyed pairing, leaving rows and out animations, FLIP (§46), and controlled form values re-asserted against the live DOM every pass. **Not cached:** a range `{#for}`, a loop inside a `<Snippet>` body, and an item loop whose explicit `key=` reads render state (kept as `.map`) — nor anything nested inside one of those.

## 31. Cached event handlers

An `@event` site whose handler is **data-independent** — the bare form, or a call whose arguments read nothing from the render beyond the DOM `event` (literals, `event` chains, arrow parameters, allowed globals like `Math.*`, all evaluated at fire time) — compiles to a per-instance cached closure (D62):

```js
'@click': ((this.__h ??= {})[3] ??= (event) => this.events.h(event))
```

The `this.events` lookup still happens at fire time; what changes is **identity** — the same function on every render. So component callback props compare equal across parent renders (a child with static, cached or memoized props does not re-run `data()`, §4), and DOM listeners at cached sites do not rebind per patch. A call that captures render data — a data root (`save(draft)` → `__d.draft`) or a library call (`save(date(when))` → `__f`) — stays a fresh closure, and a child receiving it re-runs `data()` per parent render.

**Loop handlers cache on the row (D170).** Inside an item-form `{#for}`, a handler whose arguments capture only that loop's locals rewrites them to the row's live scope and caches there:

```js
remove: (s.h0 ??= (event) => this.events.deleteTodo(s.item)),
```

`h0` counts from 0 per site; `s.item` is the row's *current* item, so one function serves every render of the row and stays right after updates, reorders and same-key replacement. Handlers reading a data root or calling a library function stay fresh, and the roots they read join the site's dirty mask. Closures over a **range** variable or a `<Snippet>` parameter stay fresh (re-created per iteration or expansion).

Site numbering is per file and deterministic (`render()` and `renderSkeleton()` share the counter). `this.__h` is reserved on instances; row-scope caches live on the row state.

## 43. Compiler accessibility warnings

**Positioned, non-fatal warnings** on the out-of-band diagnostics channel; generated JavaScript is identical whether or not a template warns (D82).

- Rules: `<img>` without `alt`; `<input type="image">` (static type) without `alt`; `<iframe>` without `title`; `<a>` without `href`; a statically positive `tabindex`.
- `alt=""` is valid. An attribute is **present** when any static, valueless, dynamic or mixed attribute carries the name; a dynamic `type`/`tabindex` never warns.
- The template and `<puzzle-skeleton>` are scanned, including `{#if}`/`{#for}`/`{#case}` bodies, component children and marker fallbacks.
- No suppression syntax, warning IDs, ARIA role matrix or click/keyboard heuristics.

## 47. The `outside` event modifier: `@event:outside`

`@click:outside={ close }` — declarative outside-dismiss on any event (D86): `@pointerdown:outside` dismisses on press, `@focusin:outside` detects focus leaving a widget.

- **Placement:** the listener attaches to **`document` in the capture phase**; the handler runs only when the target is not inside the bound element. Content a `<Portal>` inside the element moved elsewhere counts as inside (§24). Capture means an unrelated `stopPropagation()` cannot swallow the event, and the interaction that opens a panel cannot dismiss it in the same dispatch (a panel mounted mid-event attaches after the capture phase passed).
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
- **The section splitter steps over the block** with the lexer's own scanner, so splitter and lexer agree on its end: braces, quotes and `//` cannot carry the scan into `<script>`, and a literal section close tag inside is text (`<pre>{#raw}<puzzle-view>…</puzzle-view>{/raw}</pre>` compiles). When a `{#raw}` has no `{/raw}` in its own section, the first close tag inside the skipped span is kept as a fallback, used only when no close tag follows the span, so the lexer reports the unterminated block at its opener. The ESLint and Prettier plugins port this rule.
- Legal at text positions, including skeletons. A raw opener inside an attribute value is an error; an unterminated block errors at its opening brace.
- The body is static source — no expression, no runtime value. The `raw` function is the value-level path, and it sanitizes.

Client rendering creates literal text nodes. Prerendering entity-escapes ordinary element text; `<script>`/`<style>` use §36's RAWTEXT policy, and a JSON-typed script rewrites `<` as a JSON unicode escape, so `JSON.parse(el.textContent)` still works and no closing tag can break out.

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
- **Marker side:** on `<Children>` and `<Slot name="x">`, every valued attribute except `name` is a per-stamp **argument**, evaluated in the component's scope every render. A bare attribute on a marker steers to `<Snippet>`; `@event` on markers is rejected.
- **Binding by name:** argument names feed parameter names (the files compile separately); declaring a subset is legal. Parameters shadow caller fields and enclosing `{#for}` variables; the rest of the caller's scope stays visible.
- **Fallbacks:** a paired marker's body still renders when nothing fills it, so adding an argument-bearing marker breaks no caller. A stamp fills only when it renders a non-whitespace node (§24), so `{#if user.admin}…{/if}` shows the fallback where false. Plain content filling an argument-bearing marker renders the fallback and warns in development.
- **Uniqueness:** at most one snippet per `fits` name per invocation (`default` included); a snippet and a `slot="x"` element may not target the same name; a default snippet may not coexist with plain default content. §24's per-render-path rule applies (one marker in `{#for}` is the N-stamp case). Argument-bearing markers are rejected inside islands.
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
- **The family is a convention:** `.pzl` stays one class per file; a family is a directory of members plus a plain barrel (`index.js`, `index.ts` in a TypeScript app):

```js
export default Object.assign(Frame, { Wrapper, Content });
export { Frame, Wrapper, Content };
```

so both `import Frame from '@/components/Frame'` and `import { Wrapper } from '@/components/Frame'` work. `puzzle generate component Frame --family Wrapper,Content` (§13) scaffolds the directory, a stub per member and the barrel: members are PascalCase, unique, not the root, not a reserved tag name; `--family` on another kind is an error; all-or-nothing, and `--force` rewrites only the family's files. Family stubs are composition-shaped (`<Children/>` plus a caller `class` override).

## 66. Translations: the `t` function and `ctx.i18n`

The template and service contract. Rationale is in [[DECISION-D175-TRANSLATIONS]]; locale URL prefixes ([[DECISION-D177-LOCALE-URL-PREFIXES]]) are §9 in [[DOC-SPEC-ROUTER]] and the per-locale build is §13/§36 in [[DOC-SPEC-BUILD]]; translated route titles are §45.

- **Opt-in by config:** `puzzle.config.js` `i18n: { locales: ['en', 'es'], defaultLocale: 'en' }` (§11). Without it nothing ships (`__PUZZLE_HAS_I18N__` is a config fact), and `ctx.i18n`/`app.i18n` do not exist.
- **Locale files:** one `app/locales/<tag>.json` per locale, BCP 47 with `-` (`pt_BR.json` is a build error suggesting `pt-BR`). Nesting flattens to dotted keys; a flat file with dotted keys is equivalent. An object whose keys are ALL CLDR categories (`zero`, `one`, `two`, `few`, `many`, `other`) is a plural entry and must have `other`; any other object is a namespace. Values are strings, namespaces or plural entries; anything else, a duplicate flattened key, or a plural without `other` is a positioned build error. An empty object is a build warning. The build fills each locale's missing keys from the default locale.
- **`{ t(key) }` / `{ t(key, { … }) }`:** one of the 19 standard functions, registered by the i18n service; usable in every expression position.
  - The key is looked up in the active locale's table. A miss prints the key, with a development warning once per key and locale (did-you-mean). A literal key the default locale lacks is a build warning.
  - `null`/`undefined` prints nothing; a number or boolean key is stringified (`t('status.' + order.status)` works); an object, list or function key prints nothing with a development warning (usually the variables passed first).
  - Variables are ONE object — a literal or any object (a store record). `{name}` placeholders fill in one left-to-right pass (inserted text is never re-substituted); the name is the exact text between braces; it is found on the object or its class chain (computed getters, relationships), never `Object.prototype`. An unfound name stays as written; a nullish value prints nothing; values print by §6. An unclosed `{` is literal. Non-object variables are ignored with a development warning.
  - **Plurals:** with a numeric `count`, a plural entry picks its form by `Intl.PluralRules(locale).select(count)` (cached per locale), falling back to `other`; **an exact `count` of 0 uses `zero` when present**, in every locale. A plural used without `count` renders `other` with a development warning. `{count}` prints in the locale's number format only when `count` is a finite number; other variables print unformatted.
  - Output is text; markup prints literally.
- **The service:** `this.ctx.i18n` / `app.i18n` carry `t(key, vars?)`, `locale`, `dir` (`'rtl'` or `'ltr'`, from the tag's script or language), `locales`, `defaultLocale` and `setLocale(tag)`. **`locales` is the list a language switcher renders**: one `{ locale, label, href, active }` per configured locale, in config order — `label` is the language's own name (`Intl.DisplayNames`), `href` the current page in that locale (the current page for every entry without prefix routing), `active` the current one. It is rebuilt on each read, so read it in a `data()` that re-runs on navigation (a layout's or view's) and pass it down. `t` is registered at mount only if the app has none (an app `t` wins, with the standard-name warning). Without `i18n`, a template `t` hits the D43 guard, whose hint names the `i18n` config, and the build warns.
- **Display locale:** with `i18n`, the active locale replaces the viewer's in `date`, `time`, `datetime`, `number_with_delimiter`, `compact_number`, the `pluralize` count and `timeago`; an explicit `locale` argument still wins and `currency` stays locale-independent. One slot per page (two apps share it; last switch wins). A prerendered page renders in its own locale. A tag `Intl` rejects never throws during render: display and plural selection fall back to the viewer's locale.
- **Startup selection:** the URL decides first under prefix routing (the path's locale prefix, or a static page's own table island). Otherwise: (1) the stored choice `localStorage.__puzzleLocale` (try/catch; only if still configured); (2) each of `navigator.languages` — exact tag (case-insensitive), then for a Chinese tag its script (`zh-Hant` for `zh-Hant*`, `zh-TW`, `zh-HK`, `zh-MO`; else `zh-Hans`), then its base (`es-CO` → `es`), then the first configured tag with that base (`pt` → `pt-BR`); (3) `defaultLocale`.
- **Loading:** `mount()` starts the fetch while wiring services and awaits it after `beforeMount`, before the HMR restore and `router.start()`, so navigation zero never renders without strings. A prerendered page's matching inline table (`script[data-puzzle-locale]`) needs no request. A failed load falls back once to the default; if that fails, `mount()` rejects through the `beforeMount` teardown. A `t` call before strings arrive prints the key with a development warning.
- **`setLocale(tag)`:** an unconfigured tag throws a `RangeError` naming the locales (every build). **Under prefix routing** it stores the choice and loads the same page under the other locale's prefix — a full page load (§9). **Otherwise** the file is fetched first; then the table, `locale`, display locale and `<html lang>`/`dir` switch together, the choice is stored, and the page rebuilds once at the same location; the promise resolves when that rebuild commits.
  - A navigation still loading (push, `replace()`, pop, an earlier rebuild) finishes first and the page it commits is rebuilt, so `await ctx.i18n.setLocale(user.locale)` in a layout's `data()` or a guard is safe. The already-active locale changes and rebuilds nothing (unless the last rebuild into it failed: then it retries).
  - A failed fetch rejects and changes nothing. A failed rebuild (reported through `onError`) rejects and leaves the old page with the new locale active; calling again retries, and the next navigation rebuilds every level. A rebuild waiting behind a navigation reports failure through `onError` only. Overlapping calls resolve last-wins.
  - In `beforeMount` it replaces the pending startup load and rebuilds nothing; during navigation zero the first navigation lands and is then rebuilt. Store records survive a switch; `setData` state does not. Static output re-assembles its page chain (nothing animates in) and swaps it in once mounted; a mount that throws keeps the old page and rejects.
- **`<html lang>` and `dir`** are the page's locale in prerendered pages and the active locale at runtime (`dir="rtl"` is set for a right-to-left locale and removed only if it says `rtl`, so a shell's own `dir` survives), except in memory mode, which never touches the document.
- **Not built:** rich-text translations (markup inside a string), key-union types for `puzzle check`, per-route string splitting.

## 67. Runtime component selection: `<Component>`

A built-in tag selects from a finite set of compiled Puzzle components already imported by the caller ([[DECISION-D180-COMPONENT-SLOT]]). There is no global registry, lazy manifest or string-to-module resolution.

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
- **Selector scope:** only `is` may read module-scope imports and simple declared bindings from `<script>` directly (`is={ TaskCard }`, `is={ cards[key] }`). The script scan recognizes simple declarations, including later `const`/`let`/`var` declarators; destructured bindings need a simple module alias or exposure through `data()`. Loop/snippet/arrow bindings take precedence, then module bindings, then `data()`/prop fields. Every other prop, spread operand and child expression uses normal template scope. `is` still obeys §6's closed grammar.
- **Row caching:** imports and `const` selector bindings keep normal cached-row behavior (§28); mutating a const map's entries in place is not observed by a cached row. A selector read of a module `let`/`var` binding makes enclosing cached loop sites volatile, so each parent render re-evaluates the selection.
- **Props and events:** every other attribute behaves as on a normal component invocation: reactive props, callback props (`@close={ close }`) and ordered `{...props}` spreads. A loop row's key wins over any key in a spread. `name` and `from` are ordinary forwarded props. A stable constructor reuses its instance and patches props. Component `bind:` is the reserved-namespace error (§6).
- **Swaps:** changing the selected constructor tears down the outgoing instance and its descendants completely (subscriptions, listeners, refs, local state) before mounting the incoming one in the same position with current props. Only a constructor change uses immediate teardown and bypasses hide hooks and leave transitions; removing the tag itself runs the child's normal hide/leave path. Nested `<Component>` tags follow the same rule.
- **Ranges:** the selection lives in a stable start/end-comment range with no wrapper element. A component whose template root is `<Component>` occupies the whole range, recursively through nested component roots; keyed moves, conditional replacements and error recovery keep its position and boundaries.
- **Errors:** missing, valueless, string, number, boolean, template-literal or duplicate `is` is a positioned compile error, including those literals written inside braces. Nullish selectors are valid. A spread cannot supply the selector. `flip` on `<Component>` is a positioned compile error (animate a wrapping keyed element). `Component` is reserved as a tag and family root: a `Component.pzl` user component, an imported binding used as `<Component>`, or `<Component.Member>` gets a rename hint.
- **Prerender:** both output modes apply the same selection, props and default-slot rules and serialize the selected component's HTML, or nothing for a nullish selection. This is a PuzzleKit dialect feature.
