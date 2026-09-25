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
notes:
  - kind: verified
    text: >-
      Sections moved byte-for-byte from DOC-SPEC (scripted split, verified by SHA-identical section
      census); §N numbers unchanged
    sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
  - kind: state
    text: >-
      `{#for i in 1...5}` is a positioned compile error steering to `{#for 1...5, i}` — the range
      form always binds its counter after the range (0.7.0). The template whitespace rule lives in
      the §6 "Text whitespace" bullet (D168, D173 V10), which replaces the two 0.7.0 whitespace
      notes that stood here.
    sha: 513d834
  - kind: state
    text: >-
      Since D175 (v1.81, §66) the standard formatter set is 35 names: §6's "built-ins are the 34
      standard names" counts the built-in module, and `t` is the 35th standard name, registered by
      the i18n service rather than built in. With `i18n` configured, §6's locale-rendered formatters
      (`date`/`time`/`datetime`, `number_with_delimiter`, `compact_number`, the `pluralize` count,
      `timeago`) follow the app's active locale instead of the viewer's; an explicit `locale`
      argument still wins.
---

The frozen v1 contract for templates: the `@event` handler convention and its modifiers, the template grammar, DOM islands, inline SVG, composition markers and named slots, list keying, cached handlers, and compiler accessibility warnings. See [[DOC-SPEC]] for the section index and the rest of the contract.

## 5. Event handler convention

Three forms in templates, one rule each:

1. **Bare identifier** — `@click={ clearCompleted }` → the handler is invoked as `clearCompleted(event)`.
2. **Call expression** — `@click={ setFilter('all') }` or `@submit={ addTodo(event) }` → the compiler wraps the expression as `(event) => setFilter('all')`, evaluated **at event time** with `event` in scope. The handler receives exactly the arguments written in the template.
3. **Null-toggle ternary** — `@pointerdown:outside={ menuOpen ? closeMenu : null }` → each branch must itself be form 1, form 2, or `null`; the condition is evaluated against render data and a `null` branch detaches the listener while the element stays mounted (§47, D86). The grammar is deliberately narrow: `@click={ a + b }`, `@click={ (e) => close(e) }`, `@click={ this.close }`, and `@click={ handlers.close }` all remain positioned compile errors. A bare `@click={ null }` is legal and emits no handler.

`event` names the DOM event only when it is not otherwise bound. A `{#for}` item or counter named `event` shadows nothing — the loop variable wins, and the compiler emits the DOM event under an internal name instead.

```html
<form @submit={ addTodo(event) }>
<input @keydown:enter={ addTodo(event) } />
<button @click={ deleteTodo(todo) }>×</button>
<button @click={ setFilter('all') }>All</button>
<button @click={ clearCompleted }>Clear</button>
```

```js
events = {
  addTodo: (event) => { event.preventDefault(); /* … */ },
  deleteTodo: (todo) => { todo.destroy(); },
  setFilter: (filter) => { this.setData('currentFilter', filter); },
  clearCompleted: () => { /* … */ },
};
```

Form controls carrying a path-shaped `value=`/`checked=` need no handler —
they two-way bind (§6, D147); an author `@input`/`@change` on the control
suppresses the synthesis and owns the write. The curried pattern from older
examples (`deleteTodo: (todo) => () => { ... }`) is removed.

### Event modifiers (v1.7, D38)

A binding may carry `:modifier` suffixes — `@event:modifier[:modifier…]={ handler }` — that adjust dispatch declaratively. The handler value stays a plain function; the modifiers are encoded in the vnode key (`@keydown:enter:prevent`), so modifier-free bindings are unchanged.

| Modifier | Effect | Applies to |
| -------- | ------ | ---------- |
| `prevent` | `event.preventDefault()` | any event |
| `stop` | `event.stopPropagation()` | any event |
| `once` | handler fires **once ever** for this binding (the spent-marker survives per-patch handler swaps; it clears only when the binding is actually removed, so a later re-add starts fresh) | any event |
| `outside` | the listener attaches to **`document` (capture phase)** and the handler runs only when the event target is **outside** the bound element — declarative outside-dismiss for popovers/dropdowns; framework-owned cleanup on unmount (v1.52, D86 — full contract §47) | any event |
| `enter` `escape` `tab` `space` `up` `down` `left` `right` `backspace` `delete` | key filter — handler runs only when `event.key` matches (`Enter`/`Escape`/`Tab`/`' '`/`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Backspace`/`Delete`; `backspace`/`delete` added in v1.13, D45) | `keydown`/`keyup`/`keypress` only |

Modifiers stack, and **execution order is canonical regardless of written order**: outside-gate (v1.52) → key-gate → once-spend → `preventDefault` → `stopPropagation` → handler. The gates run first, so an inside event (for `outside`) or a non-matching key bails before `preventDefault` (native behavior preserved) and without spending `once`.

**Compile errors (not warnings):** unknown modifier, a key filter on a non-keyboard event, a duplicate modifier, more than one key filter, or any modifier on a **component callback prop** (component-tag `@name={...}`, D16).

```html
<input @keydown:enter={ addTodo(event) } @keydown:escape:prevent={ cancelEdit } />
<a @click:prevent:stop={ navigate('/home') }>Home</a>
<button @click:once={ claimReward }>Claim</button>
```

## 6. Template grammar (v1)

Supported:

- **Interpolation:** `{ expression }` with plain JS expressions. **Value printing (D127, D173 V6)** is one rule for every text position — a bare interpolation, a concatenated text run, and a quoted attribute (`title="{ x }"`) — in the browser and in both prerender modes: `null` and `undefined` print nothing, never the literal words (`{ user.middleName }` on a null field renders nothing). Numbers print by JavaScript's Number::toString (`0.1 + 0.2` → `0.30000000000000004`, `1e21` → `1e+21`), and `NaN` and ±Infinity print nothing. Booleans print `true`/`false`, and a zero count or a false flag still renders (`??` semantics, never `||`). A list prints its items by this same rule, joined with `,`. Any other object — a record, a plain object, a `Date`, a `URL`, a Decimal or Temporal value, anything with its own `toString` — prints nothing: format it (`| date`) or print one of its fields. A function is not an object for this rule and prints as `String` would — never interpolate one. **A brace-only attribute** (`data-x={ x }`) keeps DOM attribute semantics rather than text: `false`, `null` and `undefined` **omit** the attribute (a quoted `data-x="{ x }"` on a null value writes it empty instead), `true` writes it with an empty value, a list is a **token list** — its items print by the rule above, join with single spaces, and `false` and every item that prints nothing (`null`, `undefined`, `''`, …) are dropped (D173 V9 — so the clsx idiom `class={ [active && 'on', 'btn'] }` writes `class="btn"`) — an object **omits** the attribute, and anything else prints by the rule above. A controlled `value={ … }` is a live property rather than an attribute but prints the same way; a list passed as a component prop stays a list. An **`undefined`** value, and an object in any position, additionally log one development warning naming the expression (for a brace-only DOM attribute, the attribute name — expression labels ride only through text and quoted positions): `undefined` nearly always means a mistyped or renamed field, and an object is never display text (a `Date`'s warning names `| date`, `| datetime` and `| time`). The warnings and the names are absent from production builds. **Reading through a missing value (D173 V4):** every member and index step in a template value expression compiles to its optional form — `{ user.profile.name }` is `__d.user?.profile?.name`, `{ rows[0].label }` is `__d.rows?.[0]?.label` — so a missing intermediate object renders nothing (with the same undefined-value warning) instead of throwing a render error into the view's error handling. A path that exists evaluates exactly as before, and writing `?.` stays legal and becomes unnecessary. The first step off `this`, a standard global (`Math.max`) or a literal stays plain, as does every step of a `new` callee (`new a?.B()` does not parse); an expression the optional form cannot express at all — a tagged template, `++`/`--`, an assignment (shift assignments `<<=`/`>>=`/`>>>=` included) — is emitted unguarded. Event-handler arguments are JavaScript evaluated at fire time and are never guarded.
- **Expression boundary (contract):** template expressions are **lexed, not parsed** — the compiler tokenizes them (string/template/regex/comment-aware) and prefixes data identifiers, but has no expression grammar (§4: the Go compiler never parses JS). Consequences, by design and not bugs: (a) the only names in scope are `data()` fields, loop variables/counters, `event` (in handlers), and JS globals — an identifier imported or declared in `<script>` is **not** reachable (it compiles to a data read of the same name and evaluates `undefined`; since the pre-0.1.0 hardening pass the compiler emits a positioned **warning** when a template expression reads a name that `<script>` imports); (b) binding-introducing forms are unsupported in expressions — arrow functions and destructuring — because a lexer cannot see binding positions, and an object literal may not **start** an expression (`{ { a: 1 } }` reads as a brace inside the interpolation brace; positioned compile error). **Object literals (D173 V8)** are legal in argument and nested positions — `{ 'cart.count' | t({ count: n }) }`, `{ photo | resize({ height: 480 }) }`, `@click={ save({ id: todo.id }) }`: the lexer recognizes an object literal's keys and scopes only its values, and a shorthand property expands (`{ count }` compiles to `{ count: __d.count }`); quoted, computed and spread members are ordinary expressions. (c) Operators keep their JavaScript meaning: `==`/`!=` are loose equality (D173 V2) and nothing rewrites them to `===`; `x == null` is the absence test that means the same thing in every host. The supported idiom is unchanged: compute in `data()`, render the result.
- **Formatters:** `{ value | formatter(args) }`, chainable (`{ text | trim | capitalize }`). Display-only; filtering/sorting belongs in `data()`. **The pipe is a formatter in every value position (D173 V1):** text interpolation, quoted attribute values, brace-only attributes (`title={ price | currency }`), component props and marker arguments (`<Card label={ name | truncate(20) } />`), the `{#if}`/`{:else if}`/`{#unless}`/`{#case}` subjects (`{#if post.tags | size}`), and an attribute value's inline `{#if}`. Only a top-level single `|` is a pipe: `||` stays logical OR, and a `|` inside a string, a regex, parentheses, brackets or braces is not a split point, so a bitwise OR in one of those positions must be parenthesized (`{ (flags | mask) }`). **What follows a pipe must be a formatter name** — `[A-Za-z_$][A-Za-z0-9_$-]*`, bare or called with arguments — in every position, text interpolation included: `{ flags | 4 }`, `{ w / 2 | 0 }` and `{ a |= 2 }` are positioned compile errors steering to the parenthesized bitwise OR, never a silent lookup of a formatter named `4`. `{#unless x | f}` negates the formatted value, and a chained form value (`value={ name | upcase }`) is a one-way display binding, never an implicit two-way bind. Every chained position feeds the D31 formatter manifest scan. **A pipe in a `{#for}` header** — in the collection or either range bound — is a positioned compile error whose fix-it names the list first: shape it in `data()` and loop over that field (`{#for item in sortedItems}`). **A formatter must be a pure function of its input (contract, load-bearing since D170):** a cached `{#for}` row does not re-run its formatters, so one that reads the clock, a global, or any other ambient value would freeze its output. The shipped built-ins that do read the clock (`timeago`) are known to the compiler and make the loop site re-evaluate every render; a user-defined formatter is taken at its word. A row that must re-evaluate every render should read through `this` — `{ this.ago(createdAt) }` — which is already treated as volatile. **Unknown-formatter guard (v1.12, D43):** a formatter name not in the runtime registry does **not** crash the render — the compiled call is guarded (`(__f["name"] || __f.__missing("name"))(…)` — bracket access, since registry keys are arbitrary strings), the value passes through unchanged, and one `console.error` per unknown name identifies it (with a did-you-mean suggestion when a close match exists). A compile-time check is impossible by design: custom formatters are registered at runtime (§2), and the compiler never parses JS (§4). **Built-in `link` (v1.46, D79):** `{ path | link }` converts a path-shaped route into the mode-appropriate href via `router.url()` (§9) — `href="{ '/collections/' + c.id | link }"` renders `/collections/1` in path mode (base-prefixed under a `routerBase`), `#/collections/1` in hash mode, and unchanged in memory mode. Registered by `PuzzleApp` at mount (after the router exists), **only if absent** — a user `link` in `config.formatters` wins. Fail-soft per formatter convention: nullish → `''`, non-strings coerced; strings not starting with `/` pass through untouched (external URLs, `mailto:`, bare `#anchor`). Not part of the D31 tree-shake manifest (it needs the live router; the scanner ignores the name like any custom formatter). **Calendar dates (D114):** a bare `YYYY-MM-DD` string is a calendar date — the date family (`date`/`time`/`datetime`/`timeago`/`in_timezone`) parses it as *local* midnight, so it displays as written in every timezone (the ES spec's UTC-midnight parse showed the previous day west of UTC); invalid components keep the fail-soft raw-value path, the `iso` preset returns the string unchanged (the ISO form of a calendar date is itself), and inputs carrying a time or zone are untouched.
- **Built-in formatters: the standard set (D174).** The built-ins are the 34 standard names PuzzleKit and Sites share with the same arguments and meaning, plus the browser-only `link`, `timeago` and `in_timezone`. Numbers: `abs`, `ceil`, `floor`, `plus`, `minus`, `times`, `divided_by`/`modulo` (a zero divisor gives a missing value, which prints nothing), `round(places = 0)` (half away from zero on the decimal value; negative places round to tens), `currency(symbol = '$', places = 2)` (`-$1,234.50`), `percentage(places = 0)` (the number as written), `number_with_delimiter(delimiter?)` (the viewer's locale unless a delimiter is given), `compact_number` (`1.2K`). Text: `downcase`, `upcase`, `capitalize` (first character only), `trim`, `strip`, `truncate(length = 100, ellipsis = '…')` (code points; never longer than `length`), `replace(search, replacement = '')`, `split(separator = ',')` (`''` splits into code points; a missing value gives `[]`), `strip_html` (quote-aware; a bare `<` stays), `strip_newlines` (CR and LF), `pluralize(singular, plural = singular + 's')` (prints the locale-formatted count and the word: `3 comments`). Markup: `escape` (an identity on text), `raw` and `newline_to_br` (see Markup formatters below). Values: `default(fallback)` (for missing, `false`, `''`, `[]`; `0` is kept), `size` (code points / items / keys, else `0`), `join(separator = ', ')`, `json` (keys sorted by code point; missing and non-finite give `null`). Dates: `date`, `time` and `datetime` take `(preset = 'medium', locale?)` with presets `short`, `medium`, `long` (Intl styles in the viewer's locale and zone) and `iso` (RFC 3339 in the viewer's zone: `2026-09-24`, `15:04:05-04:00`, `2026-09-24T15:04:05-04:00`); an unknown preset is a development error and renders as `medium`. There are **no list formatters** — filtering, sorting, mapping and picking items belong in `data()` or a plain expression (`items[0]`, `items.at(-1)`); a template naming a removed one (`sort`, `where`, `map`, `uniq`, `reverse`, `compact`, `first`, `last`, `noescape`) gets the unknown-name pass-through plus a development hint naming the replacement. An app formatter may register under a standard name — the app's function wins — and draws a development-only warning (never a throw), because the name no longer means the standard thing. The identical-output part of the set is pinned by the shared conformance table `tests/conformance/formatters.json`, which Sites' Go tests run too.
- **Markup formatters (D174 group e): `raw` and `newline_to_br`.** Every other interpolation renders a text node, so no value becomes markup by accident. `{ html | raw }` injects the value as real HTML **through an allowlist sanitizer**, the same code in the browser and in both prerender modes: document markup survives (paragraphs, headings, lists, tables, `<b>`/`<i>`/`<em>`/`<strong>`/`<code>`/`<pre>`/`<blockquote>`/`<br>`, links and images), with `class`, `id`, `title`, `lang` and `dir` on any kept tag, as in DOMPurify's defaults — `id` verbatim, except never on `<img>` (it would shadow properties of a `<form>` it lands in) and never starting with `__` — and `target` on a link only as `_blank`, which always gets `rel="noopener noreferrer"`; `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>`/`<svg>`/`<math>`/`<template>`/`<noscript>` are dropped with their contents, other tags (forms, `<font>`, custom elements) are unwrapped to their text, every `on*` handler, every `style` and `name` attribute (`name` never: it is what reaches `document.<name>`), any author `rel` and any other `target` value are removed, and a URL in `href`/`src`/`srcset` survives only when relative or `http(s)` (`mailto:`/`tel:` on a link), with the scheme read after entity decoding and leading-control/whitespace removal, as the browser's URL parser reads it (every `srcset` token is checked). Because `class` and `id` survive, the value can use the app's CSS and can shadow an undefined global through `window[id]` — for untrusted user HTML that is a UI-overlay and naming risk, not code execution. The output is balanced (stray end tags dropped, open tags closed), so a value cannot leak into the page around it. `{ text | newline_to_br }` escapes the value and emits a real `<br>` for each CR LF, CR and LF, and nothing else. **A markup formatter must be the last link of a text interpolation's chain:** a formatter after it, a markup formatter in an attribute value (brace-only, quoted or inline `{#if}`), a component prop, a marker argument or an `{#if}`/`{#case}` subject, any argument (`raw(1)`), and a markup interpolation inside a raw-text element (`<script>`, `<style>`, `<textarea>`, `<title>`, `<noscript>`, `<xmp>`, `<iframe>`, `<noembed>`, `<noframes>`, `<plaintext>`) are positioned compile errors. That is how the compiler knows which interpolations render markup: it lowers them to a live-HTML vnode (`new ViewNode('#html', { value })`) that holds its position with an empty comment and owns the parsed nodes after it — mounted by parsing through an inert `<template>`, replaced when the value changes, untouched when it does not, removed and moved as a range, never reconciled inside — and it never calls the markup formatter through the registry, so an app formatter registered as `raw` is unreachable from templates (a development warning says so) and **app formatters can never inject markup**. The node is a non-text sibling for the whitespace rule (like an element), has no wrapper element, and cannot be a component root or a `{#for}` body root. The node sits behind the `__PUZZLE_HAS_RAW_HTML__` define and the sanitizer behind `__PUZZLE_HAS_RAW_SANITIZE__`, so an app that uses neither formatter ships neither, and a `newline_to_br`-only app ships no sanitizer. The allowlist and its exact output are pinned by the `raw` rows of the shared conformance table, including an XSS corpus whose every case must come out inert.
- **Conditionals:** `{#if expr} … {:else} … {/if}`. `expr` may carry a formatter chain (see Formatters).
- **Conditional chaining (v1.9, D40):** `{#if a} … {:else if b} … {:else} … {/if}` — zero or more `{:else if expr}` clauses between the `{#if}` body and the optional trailing `{:else}`, which must be the **last** clause. `expr` is any JS expression or formatter chain, exactly like `{#if}`. Desugars at parse time to nested `{#if}` nodes (additive; codegen unchanged). Spelled `else if` (JS), not `elsif` — `{:elsif}`/`{:elseif}` get a did-you-mean compile error. Compile errors: an empty condition, `{:else if}` after `{:else}`, `{:else if}` outside `{#if}`, inside `{#unless}` or `{#case}` (see D36/D37), and inside attribute-value inline-ifs (the attribute mini-grammar stays flat `{#if}…{:else}` only).
- **Inverted conditional (v1.7, D36):** `{#unless expr} … {/unless}` renders the body when `expr` is **falsy**; an optional `{:else}` renders when `expr` is truthy. `expr` is any JS boolean expression or formatter chain, exactly like `{#if}`; with a chain, the formatted value is negated. Desugars at parse time to a negated `{#if}` (additive; codegen unchanged). `{:else if}` inside `{#unless}` is a positioned compile error suggesting an `{#if}` restructuring.
- **Multi-branch (v1.7, D37):** `{#case expr}` + one or more `{:when v1, v2, …}` clauses (top-level commas are **OR**) + optional trailing `{:else}` + `{/case}`. The case expression may carry a formatter chain (`{#case status | downcase}`); `{:when}` values are plain expressions and take no chain — a top-level `|` in one is a positioned compile error (list alternatives with commas, format in the case header, or parenthesize a bitwise OR). Matching is strict `===`, **first match wins, no fallthrough**; the case expression is evaluated exactly once. Compile errors: missing case expression, zero `{:when}` clauses, non-whitespace content before the first `{:when}`, a valueless `{:when}`, a `{:when}` after `{:else}`, `{:else if}` inside a case, a `{:when}` outside any case, and unclosed/mismatched closers. Named `{#case}` (not `{#switch}`) after Puzzle's Liquid heritage — no `break`/fallthrough semantics.
- **Loops:** `{#for item in items} … {/for}` and range form `{#for 1...n} … {/for}`. A trailing `, name` on either header binds the **loop counter** — `{#for item in items, i}` (0-based index) / `{#for 1...n, x}` (the current number) — in scope throughout the block like the item variable (v1.2, D29; additive, keying unchanged). Rows are keyed automatically — pk-aware since v1.26, with an explicit `key={ … }` override on the body root; see §28 (D58). **Loop domain (D173 V12):** a list (an array) iterates; a missing collection (`null`/`undefined`) loops zero times silently; any other non-list — a string, an object, a number, a Set — loops zero times with a development warning, so a string no longer iterates its characters. Range bounds are truncated toward zero, with a development warning when the bound's numeric value is not an integer (`{#for 1...2.7}` runs 1, 2; a numeric string such as a route param's `'5'` is an integer bound and does not warn); a missing or non-finite bound runs the range zero times, as does an end below its start. The collection is guarded inside `listRows` for a lowered site and by the `loopItems` helper (`__e`) for a `.map` site; a range maps the `loopRange` helper's numbers (`__r(from, to)`), each imported only by a module that emits it. A range whose bounds are both integer literals (`{#for 1...3}`) cannot be missing or fractional, so it is constant-folded at compile time and imports no helper.
- **Attribute values:** interpolation and inline `{#if}` blocks inside attribute values, e.g. `class="base {#if done}line-through{/if}"`.
- **Bindings:** dynamic attributes — `value={ expr }`, `checked={ expr }`, `disabled={ expr }`, and any other name. **Implicit two-way binding (v1.68, D147):** a `value=`/`checked=` on a plain `<input>`/`<textarea>`/`<select>` auto-binds when its expression is exactly `ident` or `ident.ident` — the compiler synthesizes the write-back handler (`'@input:bind'`/`'@change:bind'` → `this.__bind(target, field, spec)`, a render-time call returning a memoized handler; no `__h` site, and identity is stable — hence no listener churn — for every target whose own identity is stable, which is locals and store records by construction). ALL trigger conditions must hold: (1) a plain form control, never a component (component `value` stays a prop, D16); (2) the expression is a bare identifier or one-member path — no calls, operators, brackets, `?.`, ternaries, formatter pipes, deeper chains, or `this.`; keyword/global roots and the reserved `event` root never classify; a **bare** loop variable doesn't classify, a loop-var-rooted member path (`todo.completed`) does; (3) no author `@input`/`@change` (any modifiers) — either one means the author owns the write and NOTHING is synthesized; handlers on other events (`@keydown:enter`, `@blur`) do not suppress; (4) no static `readonly`/`disabled`; (5) `type` absent or a static classifiable string — dynamic `type={ }` never binds, `checked` binds only with static `type="checkbox"`, `value` on a checkbox (the submit-value) never binds, and `file`/`radio`/`submit`/`button`/`reset`/`image`/`hidden` plus `<select multiple>` are excluded. **Event/coercion matrix:** text-ish inputs (absent type, text, search, email, password, url, tel, color), `<textarea>`, and `range` bind on `input`; `number`, `checkbox`, the date/time kinds, and `<select>` bind on `change` (numeric coercion would break the caret-preserving echo round-trip mid-typing — `"1.20"` → `1.2` would rewrite the field under the user). Numeric (`vn`) writes: `''` writes `null` (never `0`), NaN is skipped entirely. `checkbox` writes `!!checked`. A mid-IME-composition `input` (`event.isComposing`) never writes; the post-`compositionend` input lands the composed text — but state necessarily lags the DOM for the composition's duration, so a re-render driven by something else mid-composition re-asserts the stale value into the composing element. **Write dispatch:** a bare identifier writes local state (`setData` + `refresh` — `data()`-derived values stay live, so a bound filter narrows its list as you type); a member path writes the resolved root — a store record goes through validated `update()` (a rejected write reports to `onError` with `phase: 'bind'`, mutates nothing, and leaves the typed text on screen), a plain object mutates and repaints its owner. A member path whose root is missing (`value={ profile.name }` while `profile` is `null`) is **inert** until the root exists — the compiler passes `root ?? 0`, and a primitive root never writes — so it can never fall through to the bare-identifier local write and plant a stray top-level `name` key. **Non-classifying templates compile exactly as before, silently** — `value={ draft || '' }` is a one-way display binding by design. The three escapes are all existing syntax: an author handler, a non-path expression (`String(x)`), or static `readonly`. Taught rule: **bind the path you want written** — `value={ profile.name }` for record forms, bare `value={ draft }` for local drafts; a constrained free-text field binds a draft and commits via `record.update()` on submit (`record.validate()` for form UX). Migration hazard: a handler-less `value={ x }` whose value a `@keydown` handler used to commit becomes live-bound — use a non-path expression if edit-buffer semantics matter. A dev-only diagnostic warns once per key when a `data()` commit reverts a bound local key (the layer-clobber trap).
- **Events:** `@event={ … }` per section 5.
- **Components:** capitalized tags with props — `<UserProfile userId={selectedUserId} />` — imported in `<script>`. **Component-name grammar (v1.80, D167):** a component tag must be a valid member path — `Ident('.'Ident)*`, each segment `[A-Za-z_][A-Za-z0-9_]*`; any other capitalized name (a `-`, a `:`, an empty segment) is a positioned compile error (before v1.80 those compiled silently into syntactically broken JS). Dotted tags — `<Frame.Wrapper>` — emit the member expression verbatim and resolve lexically against module scope exactly like a plain `<Frame>`; there is no registry and the compiler still never reads imports. This is the **component-family** idiom: `.pzl` stays one class per file, and a family is a directory of members grouped by a plain JS barrel (`export default Object.assign(Frame, { Wrapper, Content })` plus named exports; scaffolded by `puzzle generate component Frame --family Wrapper,Content`). A dotted name whose first segment is a reserved marker name (`Children`, `Slot`, `Snippet`, `Portal` — `<Slot.Foo>`) is a positioned steering error; none of this applies inside `{#raw}` or to lowercase tags, so custom elements keep their dashes. **Script-less components (D173 V15):** a component file with no `<script>` compiles with a synthesized `data(params, props) { return props; }`, so `{ tone }` in its template reads the `tone` prop; a component with a script keeps the PuzzleKit rule that its own `data()` decides what the template sees (views and layouts have no props).
- **Component children (default slot):** children written at a component's call site render at the child's `<Children/>` marker (D16; spelled `<slot />` until v1.41 — D74 — and `<children/>` until v1.64 — D134, §24) — `<Card><p>body</p></Card>`. Guidance: **props for data, slots for markup** — pass `label="Save"` when it's a string, pass children when the caller supplies actual content.
- **Callback props:** `@name={ handler }` on a **component tag** passes the wrapped handler to the child as the prop `name`; the child receives it via `data(params, props)` and calls it like any function. DOM listeners belong to the child's own template — the event lands on the child's element first, the child's handler gates/shapes it, then invokes the parent's callback, which executes in the parent (D16).
- **Layout slot:** `<Slot/>` inside layout components renders the routed view.
- **DOM islands (v1.13, D44):** a bare static `island` attribute on a plain element makes its children browser-owned after mount — the template children render once as *seed content* and are never reconciled again, while the element's own attributes and listeners keep patching normally. See §17.
- **Element refs (v1.39, D72):** a static `ref="name"` on a plain element binds the live DOM node to `this.refs.name` — populated before `mounted()`, re-pointed on replacement, nulled on removal; the attribute never reaches the DOM. Static-string only (`ref={ expr }` is a positioned compile error — the expression boundary makes a braces form unimplementable); see §38 for the full contract and error set.
- **Comments (v1.37, D70):** `{## any text }` (inline, self-contained) and `{#comment} … {/comment}` (block; body discarded **raw** — interpolations, block tags, and malformed template code inside are ignored, so it can comment out broken markup; nested `{#comment}` blocks count). Both are erased at the lexer — no token, no vnode, nothing in the bundle — and are legal at any text position, including `<puzzle-skeleton>` bodies. Inline comments track `{`/`}` nesting depth with `\{`/`\}` escapes and are deliberately NOT string-aware (`{## don't }` is fine); a lone `}` needs `\}`. The block closer tolerates whitespace (`{/ comment }`); opener content after the keyword is ignored. HTML comments `<!-- -->` remain compile-time-stripped as always. Compile errors (positioned): unclosed `{##`, unterminated `{#comment}`, either spelling inside an attribute value, a stray `{/comment}`. Additive; comment-free templates compile byte-identically.
- **Text whitespace (D168, D173 V10):** template text renders the way the same markup renders in a browser, without source indentation leaking into the page. A run of spaces, tabs and newlines collapses to one space. Whitespace that contains a newline is **dropped** at a parent's first- or last-child edge (an element, a component's children, a marker fallback, a snippet body, or a control block's own body) and between two non-text siblings (elements, components, markers, `<Portal>`, `<Snippet>`, `{#svg}`, a `raw`/`newline_to_br` interpolation, `{#if}`/`{#unless}`/`{#for}`/`{#case}`), so stacked buttons and stacked conditionals get no gap. Between text or an interpolation and anything else it collapses to **one space**: `tokens —` + newline + `<code>a</code>,` + newline + `<code>b</code>` + newline + `and more` renders `tokens — a, b and more`; `{ first }` + newline + `{ last }` renders `John Doe`; and a space before or after a control block lands outside the block, so it renders whether or not the branch does. Nothing is invented where the source has no whitespace (`<b>x</b>{ y }` and `{ a }{ b }` stay adjacent). A **`<pre>` or `<textarea>` body is preserved exactly**, descendants and interpolations included, except the one newline directly after the start tag, which HTML's parser drops too; a `{#raw}` body's own leading newline is kept, and a `{#for}` body inside one still drops its own whitespace because a loop body is a single root element. The prerender serializer doubles a leading newline in those bodies so the page shows the same text the browser runtime mounts. Layout note: a leading or trailing space inside a flex or grid item does not render, so an icon + newline + label inside a flex button is unaffected; in inline flow, write the two on one line when no space is wanted.
- **Raw blocks (v1.70, D150):** `{#raw}…{/raw}` makes every brace in its body literal while preserving ordinary HTML parsing. See §57 for the full contract. The value-level `raw` formatter is unrelated: it runs after lexing and cannot make source braces literal.

Deferred: `$emit`/event bus. (Named slots shipped in v1.21 — D53, §24; `<puzzle-skeleton>` auto-swapping shipped in v1.8 — D39, §16.)

## 17. DOM islands (v1.13)


The declarative "this subtree's DOM is owned by someone else" primitive. Shipped in v1.13 (D44); an additive template-grammar + runtime amendment. The motivating cases are always-on `contenteditable` surfaces (the Grimoire example's Notion-style block editor) and third-party DOM mounts (maps, charts, canvas wrappers) — anywhere the virtual DOM must stop asserting ownership below a boundary element.

```html
<div contenteditable="true" island
     @input={ syncText(event) }
     @keydown:enter:prevent={ splitBlock(event) }>{ block.text }</div>
```

**Semantics.**

- **Mount:** the island's template children render normally — they are the **seed content**, and the full template grammar (§6) is available in them.
- **Patch:** the element's own **attributes and listeners patch normally** (dynamic `class=`, `@event` handler swaps). Its **children are never reconciled** — the patcher carries the previously mounted child vnodes forward and leaves the child DOM untouched, no matter what the browser (or third-party code) has done to it.
- **Identity:** keyed islands move with their DOM subtree intact. A **tag or key change replaces the node and re-seeds from the template** — changing the key is the sanctioned "reset this island" lever. **Island-ness is part of node identity too:** two conditional branches sharing a tag and key but disagreeing about `island` describe different ownership, so switching branches **replaces** the element in both directions — island→managed remounts a fresh framework-owned subtree, managed→island re-seeds and freezes. Ownership is never handed across a patch (the carried-forward vnodes of an island describe DOM its owner may have rewritten, so patching the flip would diff against a lie).
- **The attribute never reaches the DOM** — `island` is a framework directive, stripped like `key`. Style hooks belong to the author's own classes.

**Compile errors (not warnings):** a dynamic value (`island={ expr }` — island-ness cannot toggle mid-life); `island` on a component tag (it is not a prop); a component tag or any composition marker (`<Children/>`/`<Slot/>`/`<Slot name="…"/>`) anywhere inside an island subtree (a live instance inside browser-owned DOM can be destroyed out from under the framework); `island` on the `<puzzle-view>` root (the view root is the navigation/animation boundary, D20/D28).

**One-way flow, stated plainly:** after mount, data flows **out of** an island (input events → store), never into it. Listeners on seeded children *inside* the island are wired at mount and never swapped (arrow-field handlers stay correct; call-expression arguments are frozen at mount-time values). Programmatic content changes — a block merge, a "clear" action — must update **both** the island's DOM (imperatively) and the store; the framework deliberately will not re-sync store → island. When store-driven re-rendering of the content is what you want, you don't want an island.

**What v1.13 deliberately does not add:** a controlled `contenteditable` binding (two-way `text=`). `value=` on inputs works because an input holds a flat string the browser never restructures; a contenteditable holds a DOM tree the browser rewrites during editing (paste, IME composition, spellcheck). No mainstream framework ships this binding; the island is the honest version of the feature.

## 18. Inline SVG assets: `{#svg}` (v1.14)


The Shopify-snippet ergonomic for icons: one SVG file on disk, referenced by name from any template, inlined at **compile time**. Shipped in v1.14 (D46); a parser + codegen + (small) runtime amendment. The motivating case is the global icon set — cart, account, open/close — simple shapes carrying `currentColor`, recolored by hover states on the parent `<button>`.

```html
<button class="group text-gray-500 hover:text-red-500" @click={ toggleCart }>
  <span class="inline-block size-5">{#svg 'icons/cart.svg'}</span>
</button>
```

**Grammar.** `{#svg '<path>'}` is the framework's first **void block tag** — self-contained, no `{/svg}` (a stray `{/svg}` is a dedicated compile error: *`{#svg}` is self-contained — remove the `{/svg}`*). The header is exactly one single- or double-quoted **static string literal**; a non-literal path is a compile error (inlining happens at compile time, the D44 static-only precedent), and anything after the path is a compile error — per-use attributes were deliberately rejected (see below). Legal anywhere an element is: inside `{#if}`/`{#for}`/`{#case}` bodies, inside islands, and inside `<puzzle-skeleton>` (§16).

**Resolution.** Paths resolve from the conventional **`app/assets/`** folder only — `'icons/cart.svg'` means `app/assets/icons/cart.svg`. Absolute, `./`, `../`, and directory-escaping paths are compile errors (portable src strings; relative-to-`.pzl` resolution can be added later without breaking anything). `app/assets/` is **compile-time only** — never copied to `dist/` (contrast `app/public/`, which is copied verbatim and never inlined). Missing file, missing `app/assets/` dir, or a malformed file are positioned compile errors (in the `.pzl` for path problems; in the `.svg` for file problems). Under `puzzle dev`, inlined files are registered as esbuild watch files: editing only the `.svg` rebuilds, and creating a previously-missing file recovers the build.

**Inlining semantics — the file is inert.** The compiler strips an optional XML prolog/DOCTYPE, requires a single `<svg …>` root (nested `<svg>` inside is fine — depth-counted), tokenizes **only the root open tag** to lift its attributes onto a vnode, and embeds everything inside as a **verbatim string**. File contents are never template-parsed: `{ expr }`, `{#blocks}`, components, and event handlers inside the file do nothing (literal `{` is fine — it's just text). At runtime the root `<svg>` is a real vnode (the differ places/removes it; created via the SVG-namespace path) whose string children are seeded once via `innerHTML` and then **island-owned (D44)**: never reconciled, zero diff cost per patch regardless of file size. String-versus-array children are part of node identity, like the island flip: a `{#svg}` seed and authored `<svg>` markup sharing one conditional position are a replacement boundary in both directions, never a patch. The escape hatch is explicit: want a reactive or animated SVG? Paste the markup into the template directly — arbitrary SVG in templates has always compiled (no element whitelist, automatic `createElementNS` namespace propagation), `<text>` included: it shares the runtime's reserved text-node tag and is told apart by the absence of a `value` attr on the vnode (the text-node marker always carries one).

**Styling contract.** No per-use attributes on the tag — `{#svg 'path' class="…"}` was rejected as an incoherent mix of Liquid-tag and HTML-attribute syntax (Shopify's own `{% render %}` takes none). Style the icon the Shopify way: `currentColor` (and `width="100%" height="100%"` or a `viewBox`) in the file; color/hover classes on the parent; sizing via a wrapper `<span class="size-5">`, a `[&_svg]:size-5` child selector, or in-file dimensions. Liquid-style params (`{#svg 'path', class: '…'}`) remain a reserved, backwards-compatible future extension.

**Cost model, stated plainly:** each `{#svg}` use embeds its own copy of the string in the bundle — identical to hand-pasting, right for small icons. A huge SVG used many times belongs in `app/public/` as an `<img src>` instead.

**Tooling.** `pzlc` grew `--assets <dir>` (default: the nearest ancestor `app` directory's `assets/`). `puzzle init` scaffolds `app/assets/icons/heart.svg` and uses it in the default template's `Home.pzl`. Related but distinct: `import data from './x.json'` in `<script>` has always worked (esbuild's built-in JSON loader) — see DOC-PUZZLE-FILE.

## 24. Composition markers: `<Children>`, `<Slot>`, `<Slot name>` (v1.21, amended v1.41, v1.64, v1.65)

Multi-region composition. Named slots shipped in v1.21 (D53); v1.41 (D74) retired the bare lowercase `<slot/>`; v1.64 (D134) capitalized the markers; v1.65 (D141) added fallback bodies; v1.79 (D166) gave the markers data attributes and added the caller-side `<Snippet>` — see §64; 0.8.0 (D173 V13/V14) made marker uniqueness count per render path and defined when a position is filled. Two tags, three roles: **`<Children>` is the default marker** (call-site content), **`<Slot>` is the router outlet** (D30), and **`<Slot name="x">` is a named slot**. Each marker is written **self-closing** (no fallback) or **paired**, where the body is fallback content: rendered only when nothing fills that position, replaced entirely by supplied content, and an empty paired body is equivalent to self-closing. A fallback body is **ordinary template content** — interpolations and formatter pipes, `{#if}`/`{#for}`/`{#case}`, components, event bindings, refs, `{#svg}` — compiled through the same paths as any element body; the one restriction is that a composition marker may not appear inside another marker's fallback body (positioned compile error). The lowercase `<children>`/`<slot>` spellings are positioned steering errors. Capitalization uniformly means "the framework resolves this tag": components from your imports, markers from the grammar (`Children`, `Slot`, and `Snippet` are reserved tag names — parseElement matches them before component resolution). All markers compile to the same marker vnode, carrying their fallback as its children.

```html
<!-- Card.pzl -->
<puzzle-view class="card">
  <header><Slot name="header"/></header>
  <div class="body"><Children/></div>
  <footer><Slot name="footer"/></footer>
</puzzle-view>

<!-- call site -->
<Card>
  <h2 slot="header">{ post.title }</h2>
  <p>{ post.excerpt }</p>            <!-- no slot attr → default content → <Children/> -->
  <Button slot="footer" @click={ open }>Read</Button>
</Card>
```

- **When a position is filled (D173 V14).** A position is filled only when the content supplied for it **renders at least one node that is not whitespace-only text**. A call-site `{#if}` that is false (it leaves only its arity placeholder) and a `{#for}` over an empty list (it leaves nothing) both leave the position unfilled, so the fallback body shows — the empty-state pattern needs no extra syntax: `<List>{#for item in items}…{/for}</List>` against `<Children>Nothing here yet</Children>` in `List`. An element or a component in the supplied content always fills, whatever that component's own template renders. The rule is the same for the default marker, a named slot, and each snippet stamp (§64: a stamp that renders nothing shows the fallback for that stamp); a wrapper forwarding an unfilled position hands on its own marker's fallback. The expansion is shared, so hybrid and static prerender output match the browser. A marker **without** a fallback passes its content through exactly as supplied, placeholders included, so toggling a call-site `{#if}` never moves the siblings after it.
- **Keep a fallback to one root element when siblings follow the marker.** Unkeyed children are patched by position (§28), so a fallback whose node count differs from the content it swaps with shifts every sibling after the marker in the component's template, and those siblings are remounted on each flip — an `<input>` loses focus and a child component loses its state. `<Children><p class="empty">Nothing here yet</p></Children>` is safe; a fallback of two sibling elements next to a trailing `<input>` is not. Wrap a multi-node fallback in one element, or put the marker last. The runtime does not pad fallbacks.
- **`<Children>` — the default marker.** Renders the invocation's untagged direct children (or, in a routed view/layout, whatever fills the default bucket). Its only attributes are **snippet arguments** (§64) — `<Children user={ user }>` hands `user` to the snippet filling this position; every other attribute is a positioned compile error (`ref` gets the render-target message, D72; a bare attribute steers to `<Snippet>`, where bare names declare parameters). Unfilled, it renders its fallback body — or nothing when self-closing (there is no is-slot-filled probe; the fallback body is the default-content mechanism, D141). **One default marker per render path**, counting `<Slot>` too (D173 V13): the mutually exclusive branches of one `{#if}`/`{:else if}`/`{:else}`, `{#unless}`/`{:else}` or `{#case}` are separate paths, so `{#if compact}<div><Children/></div>{:else}<section><Children/></section>{/if}` is legal. A marker before or after that block, two markers in one branch, and markers in two separate `{#if}` blocks share a path and are a positioned compile error. A marker inside a `{#for}` body is one declaration however many times the loop runs — the snippet N-stamp case (§64) — and two in one loop body are an error. Argument-bearing markers follow the same rule.
- **`<Slot>` — the router outlet.** Bare: the canonical spelling in routed shells/layouts (D30 fills it). A fallback body renders when no child route occupies the outlet — a parent route rendering as the leaf. The compiler cannot tell a view from a component (same `.pzl` format), so `<Slot>`-in-views vs `<Children>`-in-components is a documented convention over one mechanism, not an enforced split.
- **`<Slot name="x">` — a named slot.** `name` is static, non-empty, and unique per render path (the V13 rule above, per name); `name="default"` and `name="children"` are reserved (both steer to `<Children/>`). Renders the call-site children tagged `slot="x"`; unfilled, its fallback body — or nothing when self-closing. Every valued attribute besides `name` is a snippet argument (§64).
- **Retired spellings (v1.64, D134):** any `<children…>` or `<slot…>` tag is a positioned compile error steering to the capitalized form — `<Children/>` for the default marker, `<Slot name="x"/>` for a named slot, with the bare-`<slot>` error naming both replacements. A lowercase `<snippet …fits>` steers the same way (§64); a plain `<template>` element is ordinary HTML and means nothing to the framework.
- **Call-site side (unchanged, D53):** a **static** `slot="x"` attribute on a **direct child** (element or component tag) of a component invocation routes it to that region; the attribute is stripped from the rendered output. Direct children without one form the default content.
- **Compile errors (unchanged, D53):** dynamic `slot={expr}` on a direct component child; a control-flow block at direct-child level containing top-level `slot`-attributed elements (put the condition inside the slotted element instead). Elsewhere, `slot` is the ordinary HTML global attribute and passes through.
- **Views/layouts (unchanged):** one marker type, one expansion pass — but the router only ever fills the DEFAULT bucket; a named slot in a routed view's template renders its fallback (or nothing when self-closing), never routed content.
- **Forwarding through a component (v1.38, D71 — respelled by v1.64, extended by v1.79):** a default marker placed INSIDE a component invocation forwards the enclosing template's default content through that component — `<Card><Children/></Card>` in a layout hands the routed page to Card's default slot (`<Slot/>` works identically in that position — same node). The expansion walk substitutes the enclosing template's markers in call-site children before the inner component expands its own; a routed vnode's pinned instance rides along and mounts as usual. When the enclosing position is unfilled (V14), the forwarding marker hands on its own fallback body, or nothing when self-closing, so the inner component's fallback shows. Only the default marker forwards: `<Slot name="x"/>` inside a component invocation is a positioned compile error (no defined fill source — the router fills the default slot only), enforced through nested elements, control flow, and deeper invocations. Forwarding carries **snippets too** (v1.79, D166): the caller's `<Snippet>`s ride through that bare `<Children/>` into the inner invocation alongside the default content, unmodified and uninvoked, transitively through wrapper chains — so a wrapper exposes its inner component's snippet points by doing nothing more than forwarding (§64).
- Scoped slots shipped in v1.79 as **snippets** — see §64.

## 28. List keying (v1.26)




How `{#for}` rows get their reconciliation keys, and what a key buys a row besides identity. Shipped in v1.26 (D58); **amended, D170** (0.8.0 — rows are cached between renders, and the key is where the cache is kept). Codegen + one ViewNode static; byte-identical emission for range-form loops and for `key` attributes outside loop roots.

- **Auto-key is primary-key-aware.** An item-form `{#for item in items}` body root gets a synthetic `key: ViewNode.keyOf(item)` (previously the hardcoded `item.id`). `ViewNode.keyOf` resolves at render time: a store record (a `PuzzleModel` instance) keys by its model's `primaryKey()` field — so `Puzzle.string().primary()` on `main_id` keys lists by `main_id` with no template change — and any other value keys by `.id` exactly as before. `keyOf` is internal surface (like `SLOT_TAG`): compiled output calls it; app code shouldn't.
- **Explicit key overrides.** A `key={ … }` attribute written on the `{#for}` body root (element or component, item or range form) **replaces** the synthetic key — the compiler skips its prepend; the author's expression is used verbatim (`keyOf` is not applied). This is the sanctioned escape hatch for non-record data with a different identity field. Keys must be stable and unique across the collection. (Previously an explicit key silently emitted a **duplicate** `key:` property alongside the synthetic one — that hazard is gone.)
- **Null keys warn.** When `keyOf` resolves `null`/`undefined` (no `.id`, unmodeled data), it warns once — naming the offending item shape — and returns null, so the list degrades to positional diffing **diagnosed** instead of silently. The existing duplicate-key warning (§ v1.23 review pass) is unchanged and covers the colliding-values case. Production builds already strip `console.*`; the warning is dev-only in effect.
- **Range form unchanged:** range/counter loops key by the generated number (unique by construction) with byte-identical emission to v1.25.

**Row state and the caching contract (amended, D170).** An item-form `{#for}` keeps one **row state per key** for as long as the site keeps showing that key. The row holds the item, the index, the record's stored render revision, the live scope object the row's handlers close over, the row's last rendered vnode subtree, its static-subtree caches and its nested loop blocks. On a parent render the site returns the **same vnode subtree** for a row whose inputs did not change, and the patcher skips it whole. What counts as changed:

- **Records** — a different reference, or an advanced **render revision**: the store's notification sequence for that record's last observable mutation. Every mutation that notifies advances it (`createRecord`, `update()`, `removeRecord`, adapter upserts and save reconciliation).
- **Plain objects and arrays** — always. They can be mutated in place with no revision to observe, so their rows rebuild every render, exactly as before. Primitive items compare by value.
- **The index** — only when the body reads the loop counter.
- **A parent `data()` root the body reads** (`selectedId === todo.id`), when that root changed this render. An object-valued root counts as changed every render, because it can be mutated in place.
- **An unanalysable body** — one whose expressions reach through `this`; read a **mutable global** (`Date`, `Math.random`, `window`, `document`, `location`, `globalThis`, …); pipe through a built-in formatter that reads the clock (`timeago`); or read the **item or counter of an enclosing `{#for}`**, which makes the reading loop and every loop between it and the owner re-evaluate whenever the outer row does. Or a **conservative** site: one whose body reads a relation, a computed getter, or any path deeper than one level off the loop item. A record's revision describes its own fields and nothing further, so such a site never caches its record rows. The check runs once per model class against the model's schema and relationship names.
- **An opaque read of the item.** The loop item is on identity alone only where the compiler can see what is read off it: a direct member access (`{ todo.text }`, `todo?.text`) or a whole-value read that IS the whole expression (`{ todo }`, `todo={ todo }`, a handler argument such as `@click={ del(todo) }`). Anywhere else — piped through a formatter (`{ post | authorName }`), passed into a call, interpolated into a template literal, or reached through parentheses or a comment — the value could be read arbitrarily deep, so the site is conservative like a relation read.

Handler **arguments** are exempt from every rule above: they are evaluated at fire time against the live row, which is why `this.…`, a mutable global, and an enclosing row's local are all free there.

Two rules follow, and they are contract, not implementation detail:

- **A record mutated by direct field assignment (`todo.title = 'x'`) is not observed.** It advances no revision and notifies nobody — the store has never re-rendered anything for it either. Mutate records through `update()` or a store path.
- **Duplicate keys within one pass are uncached.** Both rows build fresh (today's positional semantics) and development warns once; a shared key would otherwise alias two logical rows onto one row state. A **null** key is uncached for the same reason, and keeps `keyOf`'s existing warning.

Everything else about a keyed list is unchanged: the shared sibling key namespace, mixed keyed/unkeyed pairing, leaving rows and their out animations, FLIP (§46), and the duplicate-key warning the patcher already emits. Controlled form values inside a cached row are re-asserted against the live DOM on every pass, as §6's binding contract requires. Three loop bodies are **not** cached and emit as they did before: a range `{#for}`, a loop inside a `<Snippet>` body (stamped fresh per expansion), and an item loop whose explicit `key=` reads render state and so kept `.map`. Nothing nested inside one of those is cached either — such a body is emitted once and evaluated per iteration, so one row state would be shared by every iteration.

## 31. Cached event handlers (v1.29)


Every `@event` site whose handler is **data-independent** — the bare form `@click={ h }`, or the call form when its arguments reference nothing from the render scope beyond `event` (literals, `event`, `this.…`, and JS globals are all fine: they're evaluated at fire time *inside* the closure) — compiles to a per-instance cached closure (D62):

```js
'@click': ((this.__h ??= {})[3] ??= (event) => this.events.h(event))
```

instead of a fresh arrow per render. Handler *semantics* are unchanged (`this.events` lookup still happens at fire time); what changes is **identity** — the same function object is passed on every render of the instance. Consequences:

- **Component callback props now compare equal across parent re-renders.** A child whose props are all static, cached, or memoized (§32) no longer re-runs `data()` on every parent render — this restores §4's prop-reactivity rule (`data()` re-runs when props *change*), which fresh-closure callback props had made fire on phantom changes since v1.
- **DOM listeners at cached sites stop rebinding per patch** (`patchAttrs` sees an unchanged value). The `:once` spent flag is unaffected — it lives on the element, not the handler function.
- **Call forms that capture render data** (`save(draft)` → `__d.draft`) still emit fresh closures, byte-identical to v1.28 — `__d` is a per-render snapshot, so caching such a closure would freeze it, and a component receiving one still re-runs `data()` per parent render (correct: the prop really is new).

**Loop handlers cache on the row (amended, D170).** Inside an item-form `{#for}`, a handler whose arguments capture only that loop's locals is **not** a fresh closure either. Its locals rewrite to the row's live scope object and the closure caches there:

```js
remove: (s.h0 ??= (event) => this.events.deleteTodo(s.item)),
```

`h0` is counted from 0 per loop site. The row scope lives as long as the row does and `s.item` is the row's *current* item, so one function object serves every render of that row and still reads the right record after an update, a reorder, or a replacement under the same key — which is why a list's callback props no longer wake every child on every parent render. Handlers whose arguments read `__d.` keep the fresh-closure emission above, and the parent roots they read count toward the loop site's dirty mask so the row rebuilds when that data changes. A closure over a **range**-loop variable or a `<Snippet>` parameter also stays fresh: those bindings are re-created per iteration or per expansion.

Site numbering is per-file and deterministic (`render()` and `renderSkeleton()` share the counter), so recompiling an unchanged file stays byte-stable. `this.__h` joins the emitted `__d`/`__f` as a reserved name on component instances; the row-scope caches live on the list block's row state and reserve nothing (§4).

## 43. Compiler accessibility warnings (v1.48)

The compiler emits **positioned, non-fatal warnings** (never errors) for five template accessibility mistakes, on the same out-of-band diagnostics channel as the script-import collision warning — generated JavaScript is byte-identical whether or not a template warns (D82).

- Rules: `<img>` without `alt`; `<input type="image">` without `alt` (only when `type` is statically `image`); `<iframe>` without `title`; `<a>` without `href`; a statically positive `tabindex`.
- `alt=""` is valid (decorative images) and never warns. An attribute counts as **present** when any static, valueless, dynamic (`alt={expr}`), or mixed attribute carries the name — the rules never guess about runtime values, and a dynamic `type`/`tabindex` never warns.
- Both the template and `<puzzle-skeleton>` are scanned, descending into `{#if}`/`{#for}`/`{#case}` bodies, component call-site children, and marker fallback bodies (D141).
- No suppression syntax, no warning IDs, no ARIA role matrix, no click/keyboard heuristics — five reliable rules over a rules engine. Additions are SPEC amendments.

## 47. The `outside` event modifier: `@event:outside` (v1.52)

`@click:outside={ close }` — a generic event modifier (§5 table, D86) for declarative outside-dismiss. Works on any event: `@pointerdown:outside` dismisses on press, `@focusin:outside` detects focus leaving a widget.

- **Placement semantics:** the listener attaches to **`document` in the capture phase**; the handler runs only when `el.contains(event.target)` is false for the element carrying the binding. Capture is load-bearing: an unrelated component's `stopPropagation()` cannot swallow the outside event, and the interaction that opens a panel cannot dismiss it in the same dispatch (a panel mounted synchronously mid-event attaches after document's capture phase has passed).
- **Gate order:** the outside-gate runs before every other modifier step (§5's canonical order) — an inside event spends no `once`, triggers no `preventDefault`.
- **Lifecycle:** the framework owns the document listener. It attaches when the bound element mounts and detaches on every removal shape (conditional toggle, keyed-row removal, subtree teardown, full view destroy) and on the inline-null toggle (`@pointerdown:outside={ open ? close : null }`). The idiomatic form puts the binding on the panel root inside `{#if open}`, so the listener's lifetime tracks the panel; the always-mounted alternative is the root-element binding with the null-toggle.
- `@click` and `@click:outside` on one element are independent bindings. Existing §5 compile errors are unchanged (`outside` on a component callback prop is rejected like every modifier).
- **Documented limitations:** events inside an `<iframe>` never reach the parent document; on touch, `pointerdown` fires at scroll-start — prefer `@click:outside` where scroll tolerance matters. The event choice is the author's.

## 57. Raw template blocks: `{#raw}…{/raw}` (v1.70)


`{#raw}` disables Puzzle's brace lexer for its body. It is the static-source
escape for JSON, JavaScript, CSS, and examples that need literal template-like
syntax:

```html
<script type="application/json" data-tarot-options>
  {#raw}{ "loop": true, "slidesPerView": 3 }{/raw}
</script>

<pre>{#raw}const shape = { a: 1, b: [2, 3] };{/raw}</pre>
```

- Every `{`/`}` sequence in the body is literal text: interpolations,
  `{#if}`/`{#for}`/`{#comment}`, branches, closers, formatter pipes, and
  brace-valued event bindings do not activate template grammar.
- HTML remains structural. `{#raw}<b>hi</b>{/raw}` emits a real `<b>` vnode,
  not the source string `"<b>hi</b>"`. Attributes inside that markup are static;
  `@click={ handler }` is an authored literal attribute, never a Puzzle listener.
- A brace-valued attribute keeps its bytes verbatim, but the scan that finds its
  closing `}` is JS-lexically aware — a `}` inside a string, template literal,
  regex literal, or comment does not end the value, so `data-json={ {"text": "}"} }`
  survives intact. The one consequence: an unbalanced quote inside such a value
  swallows the closer and is a positioned compile error, even though nothing in
  a raw block is otherwise interpreted. Only the boundary comes from that scan;
  the bytes it spans are never given meaning.
- The block does not nest. The first tolerant closer wins: `{/raw}`,
  `{/ raw }`, and `{/raw }` are equivalent. A literal `{/raw}` therefore cannot
  occur in the body. Content after the opener keyword is ignored, matching
  `{#comment}`.
- Raw blocks are legal at text positions, including skeleton bodies. A raw
  opener inside a quoted or brace-only attribute value is a positioned compile
  error. An unterminated block errors at its opening brace with the expected
  `{/raw}` closer.
- The body is static, author-written source. It accepts no expression and no
  runtime value, so it is not dynamic raw-HTML injection; `{@html expr}` remains
  deferred.

Client rendering creates literal text nodes. Prerendering is parent-aware:
ordinary element text is entity-escaped in the HTML string and decoded back by
the HTML parser, while `<script>`/`<style>` use §36's D113 RAWTEXT policy. A
JSON-typed script still rewrites `<` to its JSON-transparent unicode escape,
preserving `JSON.parse(element.textContent)` while preventing a closing-tag
breakout.

## 64. Snippets: `<Snippet>` + marker data attributes (v1.79)



Slots render a passed-in template; **snippets render it repeatedly, with data**.
A `<Snippet>` is a caller-declared body with parameters; the component stamps it
once per item by handing values to its own marker. Shipped in v1.79
([[DECISION-D166-SNIPPETS]]); it extends §24 and changes nothing about a
template that does not use it.

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

**Grammar.** `<Snippet>` is a third reserved marker tag, matched before
component resolution like `Children` and `Slot`. It is **paired-only** (a
self-closing `<Snippet/>` is a positioned compile error) and legal **only as a
direct child of a component invocation** — the same position rule the `slot="x"`
attribute has, including the rejection of control-flow blocks at that level.
`fits="x"` is a static, non-empty string routing the snippet to
`<Slot name="x">`; omitted, it fills the default `<Children>` position. **Every
other attribute is bare and declares a parameter**: `fits` is the only attribute
on `<Snippet>` that takes a value, and a valued parameter (`user={ … }`), an
`@event`, or a dynamic/mixed attribute is a positioned error steering to the
bare form. Parameter names must be valid identifiers, must not repeat, and must
not be `fits`. A lowercase `<snippet>` carrying `fits` steers to `<Snippet>`;
`<template>` remains an ordinary HTML element with no framework meaning.

**Marker side.** On `<Children>` and `<Slot name="x">`, every valued attribute
other than `name` becomes a per-stamp **argument**, evaluated in the component's
scope and rebuilt on every render. A bare attribute on a marker is a positioned
error steering to `<Snippet>`. `@event` attributes on markers stay rejected.

**Binding is by name.** The marker's argument names feed the snippet's declared
parameter names — the two files compile separately, so neither can know the
other's ordering. Declaring a subset of what the marker hands over is legal.
Parameters shadow both caller data fields and enclosing `{#for}` variables, the
same way a loop binding does; the rest of the caller's scope stays visible
inside the body.

**Fallbacks (D141, D173 V14).** A paired marker body still renders when
nothing fills the position, so adding an argument-bearing marker to an existing
component breaks no existing caller. A stamp fills its position only when it
renders at least one node that is not whitespace-only text (§24), so a snippet
whose body is `{#if user.admin}…{/if}` shows the marker's fallback for every
stamp where the condition is false. Plain (non-snippet) content filling an
argument-bearing marker renders the fallback and warns in development.

**Uniqueness and placement.** At most one snippet per `fits` name per
invocation, `default` included; a snippet and a `slot="x"` element may not
target the same name, and a default snippet may not coexist with plain default
content. The §24 per-render-path marker-uniqueness rule applies to
argument-bearing markers exactly as to plain ones: one marker inside `{#for}` is
a single declaration, which is precisely the intended N-stamp case, and markers
in mutually exclusive `{#if}`/`{#case}` branches are separate paths.
Argument-bearing markers remain rejected inside `island` subtrees (§17).

**A snippet body is a composition LEAF.** `<Children>`, `<Slot>`, and
`<Snippet>` are positioned compile errors anywhere inside a `<Snippet>` body, at
any depth — **including a `<Snippet>` on a component invocation inside that
body**. Stamped output cannot declare composition positions; the marker belongs
in the component's own template. Ordinary component invocations are legal in a
snippet body, and so is `<Portal>` — it relocates DOM rather than declaring a
composition position, so it is walked like any element, though a marker *inside*
the portal is still rejected. Nesting a snippet is expressed by **extraction** —
move that invocation and its snippet into their own component, whose template
holds the marker at top level, and name that component in the snippet body.
`ref=` is rejected there for the same stamped-N-times reason (§38: a ref names
one element on one instance). §24's nested-fallback restriction does not apply
to a snippet body.

**Semantics.** A snippet compiles to a function carried in the invocation's
**children**, not its props: it closes over the caller's render data, so it
cannot be identity-cached, and as a prop it would defeat the §31 shallow compare
and re-run the child's `data()` on every caller render. Each stamp calls that
function with its own arguments and gets **fresh vnodes**, so N stamps patch
independently through ordinary keyed reconciliation (§28). A component re-render
re-invokes; a caller re-render rides the existing slot-only update path. Both
prerender modes (§36) share the same expansion and stamp snippets with no
special case, and a prepared takeover tree expands exactly once.

**Forwarding through wrappers.** A bare `<Children/>` placed inside a nested
component invocation forwards the caller's snippets alongside the default
content (§24, D71): `DatePicker` rendering `<Calendar …><Children/></Calendar>`
hands a caller's `<Snippet fits="day" …>` to Calendar's `day` marker with `fits`,
parameters, and function intact and never invoked on the way. The rule is
transitive through wrapper chains; an argument-bearing marker still stamps
locally and never forwards; a wrapper may both stamp and forward the same
snippet. A snippet nothing in the chain stamps is never invoked and never
reaches the DOM. Runtime-only, behind the same gate.

**Development diagnostics** (absent from production builds): a
parameter/argument shape mismatch, an argument-bearing marker filled with plain
content, and a snippet whose output contains a composition marker. Each warns
once per component and position. There is deliberately no "unused snippet"
diagnostic — a marker inside a false `{#if}` or an empty `{#for}` is not visited
either, so nothing consuming a snippet is not evidence of a mistake.

**Cost.** The feature is gated behind `__PUZZLE_HAS_SNIPPETS__` (D89): an app
using no snippet and no marker argument pays **zero bytes** and takes the same
expansion fast path it took before; an app that uses them pays about 50 B gzip.

## 65. Component families: dotted component tags (v1.80)


Related components import as one unit and invoke with dot notation. Shipped in
v1.80 ([[DECISION-D167-COMPONENT-FAMILIES]]); the §6 component bullet is the
short form, this section is the contract.

```html
<script>import Frame from '@/components/Frame';</script>

<Frame><Frame.Wrapper><Frame.Content>…</Frame.Content></Frame.Wrapper></Frame>
```

**Tag-name grammar.** A capitalized tag that survives marker resolution must be
a valid member path — `Ident('.'Ident)*`, each segment
`[A-Za-z_][A-Za-z0-9_]*`. Any other capitalized name — a `-`, a `:`, an empty
segment (`<Frame-x>`, `<Frame:Wrapper>`, `<Frame.>`) — is a positioned compile
error. This is a bug fix as much as a feature: the tag text has always been
emitted verbatim as the ViewNode tag expression, so `<Frame.Wrapper>` already
compiled to `new ViewNode(Frame.Wrapper, …)`, but nothing validated the name and
those spellings compiled cleanly into syntactically broken JavaScript. A dotted
name whose first segment is a reserved marker name (`Children`, `Slot`,
`Snippet`, `Portal` — `<Slot.Foo>`) is a positioned steering error. The check
does not run inside `{#raw}` and never applies to lowercase tags, so custom
elements keep their dashes and namespaced SVG is untouched.

**Resolution is lexical, and codegen is unchanged.** A dotted tag emits the
member expression verbatim and resolves against module scope at runtime exactly
like a plain `<Frame>`. There is no component registry, and the compiler still
never reads imports (§4).

**The family is a convention, not a mechanism.** `.pzl` stays strictly one class
per file; a family is a directory of member files beside a plain JS `index.js`
barrel that re-exports them and hangs them off the root:

```js
export default Object.assign(Frame, { Wrapper, Content });
export { Frame, Wrapper, Content };
```

so both `import Frame from '@/components/Frame'` and
`import { Wrapper } from '@/components/Frame'` work.
`puzzle generate component Frame --family Wrapper,Content` (§53 CLI) scaffolds
the directory, one component stub per member, and the barrel: member names are
PascalCase-validated, may not repeat, may not collide with the root, and may not
be marker names; `--family` on a non-component kind is an error; the scaffold is
all-or-nothing, and `--force` rewrites only the family's own files. Family stubs
are composition-shaped (`<Children/>` plus a caller `class` override) because a
closed stub would silently drop nested members. Without `--family`,
`generate component` output is byte-identical to before.

## 66. Translations: the `t` formatter and `ctx.i18n` (v1.81)


Shipped in v1.81 ([[DECISION-D175-TRANSLATIONS]], which holds the rationale and
rejected alternatives). This section is the contract; the build side is in
[[DOC-SPEC-BUILD]] and the switch rebuild in [[DOC-SPEC-ROUTER]].

**Opt-in by config.** `puzzle.config.js` declares
`i18n: { locales: ['en', 'es'], defaultLocale: 'en' }` (§11). Without it,
nothing ships: `__PUZZLE_HAS_I18N__` is a config fact, not a usage-scan fact,
and existing bundles stay byte-identical. `ctx.i18n` and `app.i18n` exist only
when `i18n` is configured.

**Locale files.** One `app/locales/<tag>.json` per configured locale, named by a
BCP 47 tag with `-` (`pt-BR.json`; `pt_BR.json` is a build error suggesting the
`-` spelling). Files may nest; nesting flattens to dotted keys, and a flat file
with dotted keys is equally valid. An object whose keys are ALL CLDR category
names (`zero`, `one`, `two`, `few`, `many`, `other`) is a plural entry and must
have `other`; any other object is a namespace. Values are strings, namespaces
or plural entries; anything else, a duplicated flattened key, or a plural entry
without `other` is a positioned build error. An empty object (a whole file, or a
namespace) is a build warning: it defines no keys.

**`{ key | t }` and `{ key | t({ … }) }`.** `t` is one of the 35 standard
formatter names ([[DECISION-D174-STANDARD-FORMATTERS]]) but not a built-in: the
i18n service registers it. It runs in every value position (D173 V1): text, a
quoted attribute, and a brace-only attribute or prop
(`placeholder={ 'search.hint' | t }`).

- The key is looked up in the active locale's table, which the build has
  already filled from the default locale. A miss prints the key itself — never
  blank — with a development warning once per key and locale (did-you-mean from
  the table's keys). A literal key the default locale lacks is also a build
  warning.
- A `null`/`undefined` input prints nothing; any other input is stringified, so
  runtime-built keys work (`{ ('status.' + order.status) | t }`).
- The variables are ONE object: an inline literal (`t({ name: user.name })`,
  D173 V8) or any object value (`t(user)`, a store record). `{name}`
  placeholders fill in a single pass, left to right — inserted text is never
  substituted again. The name is the exact text between the braces (no
  trimming). A name is found on the object itself or on what it inherits from
  its class (a model's computed getters and relationships), never on
  `Object.prototype` (`{constructor}` stays literal). A name that is not found
  stays visible as written; a found name with a nullish value prints nothing;
  values print by the §6 value-printing rule. A `{` without a closing `}` is
  literal text. Non-object variables are ignored with a development warning.
- **Plurals.** With a numeric `count` in the variables, a plural entry picks its
  form by `Intl.PluralRules(locale).select(count)` (cached per locale); a
  missing category falls back to `other`. **An exact `count` of 0 uses the
  entry's `zero` form when it has one**, in every locale — even English, whose
  CLDR rules never select `zero` (the Rails/Shopify rule, so "Your cart is
  empty" needs no template branch). A plural entry used without `count` renders
  `other` with a development warning.
- `{count}`, when `count` is a finite number, prints in the active locale's
  number format — the helper `number_with_delimiter` and `pluralize` share;
  other variables print unformatted.
- Output is text: markup inside a translation prints literally.

**The service.** `this.ctx.i18n` / `app.i18n` carry `t(key, vars?)` (the same
function the formatter calls), `locale`, `locales` (config order),
`defaultLocale`, and `setLocale(tag)`. The `t` formatter is service-bound like
`link`: registered at mount only if the app registered no `t` of its own (an
app `t` wins, with the standard-name shadow warning). Without `i18n`, a
template `t` hits the D43 guard, whose development hint names the `i18n`
config, and the key prints through; the build warns too, noting that an app
registering its own `t` is fine (the compiler cannot see app.js).

**Formatter locale.** With `i18n` configured, the active locale replaces the
viewer's in every locale-rendered formatter — `date`, `time`, `datetime`,
`number_with_delimiter`, `compact_number`, the `pluralize` count and
`timeago`. An explicit `locale` argument to the date family still wins, and
`currency` stays locale-independent. The locale is one slot per page (two
mounted apps share it; the last switch wins), set by the service on load and
on every switch; prerendered pages render dates and numbers in the default
locale. Without `i18n`, those formatters keep the viewer's locale.

**Locale selection at startup.** (1) the stored choice
`localStorage.__puzzleLocale`, read inside try/catch and used only if still
configured; (2) each of `navigator.languages` in order — the exact tag
(case-insensitive), then its base language (`es-CO` → `es`), then the first
configured tag with that base (`pt` → `pt-BR`); (3) `defaultLocale`. The
prerender always uses `defaultLocale`.

**Loading.** `mount()` starts loading the chosen table while services are
wired, so the fetch overlaps `beforeMount`, and awaits it after `beforeMount`,
before the HMR restore and `router.start()`: navigation zero never renders
without its strings. A prerendered page's inline table
(`script[data-puzzle-locale]`) is used without a request when it matches. A
failed load falls back once to the default locale; if that fails too, `mount()`
rejects through the `beforeMount` teardown. A `t` call before the strings
arrive prints the key, with a development warning.

**`setLocale(tag)`.** An unconfigured tag throws a `RangeError` naming the
configured locales (every build). Otherwise the new file is fetched first; only
then do the table, `locale`, the formatter locale and `<html lang>` switch
together, the choice is stored (try/catch), and the page rebuilds once at the
same location ([[DOC-SPEC-ROUTER]]). A push still loading when the switch lands
is let finish first, and the rebuild runs on the page it committed. A failed
fetch rejects and changes nothing. A rebuild that fails (a `data()` throw,
reported through `onError`) rejects too, and leaves the old page on screen with
the new locale already active — the next navigation rebuilds every level in it.
Overlapping calls resolve last-wins. Called before the first commit, it
replaces the pending startup load and rebuilds nothing. Store records survive a
switch; `setData` local state does not, so state that must survive a language
switch belongs in the store. Static output re-assembles and re-mounts its page
chain instead.

**`<html lang>`** is the default locale in every prerendered page (the build
rewrites the shell's `lang`), and the runtime sets it to the active locale on
load and on every switch.

**Not in v1.81 (future work):** translated route `meta.title` (static by §45),
locale URL prefixes, rich-text translations, `dir="rtl"`, key types for
`puzzle check`.
