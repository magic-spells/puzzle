---
name: Template syntax — user guide
status: verified
verified_at: '2026-07-22T00:04:06.109Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-PUZZLE-FILE
  - DOC-EVENTS
  - DOC-USER-GUIDE
---

# Puzzle template syntax

A practical guide to the markup inside `<puzzle-view>`. The contract — every rule and error — is [[DOC-SPEC-TEMPLATE]] (§ numbers below), and the full expression grammar (method table, globals, operators) is [[DOC-LANGUAGE-CORE]] "Expressions". File anatomy is [[DOC-PUZZLE-FILE]]; handlers are [[DOC-EVENTS]]. Examples come from the todos app (`examples/todos`).

## Interpolation

`{ expression }` renders a value as text. The expression reads what `data()` returned — never the view instance (a template has no `this`).

```html
<span>{ todo.text }</span>
<div>{ activeTodos.length } left</div>
<p>{ nickname ?? name }</p>
<p>{ `${user.first} ${user.last}` }</p>
```

- Expressions are JavaScript: fields (`a.b`, `a[i]`), `+ - * / %`, comparisons, `&& || !`, the ternary, template literals, and `??` for fallbacks (`||` would swallow `0` and `''`).
- `.length` counts a list or a string.
- **Methods** from a fixed table work on strings, lists and numbers — `{ name.trim() }`, `{ tags.join(', ') }`, `{ items.at(-1).title }`, `{ total.toFixed(2) }`. None mutate: use `toSorted()`, `toReversed()`, `concat()`.
- **Globals** from a short list: `Math.*`, `Number()`, `String()`, `Boolean()`, `Array.isArray()`, `Object.keys/values/entries()`, `parseInt`, `parseFloat`, `encodeURIComponent` and friends.
- Arrow functions go only in call arguments: `todos.filter(t => !t.done)`.
- Reading through a missing value never throws: `{ user.address.city }` prints nothing when `address` is missing.
- `null` and `undefined` print nothing; an object prints nothing (print a field, or format it).
- Anything outside the grammar — `new`, `typeof`, regexes, assignment, `window`, `this`, a method not in the table — is a positioned compile error that tells you what to write instead.

Model getters work like fields: `{ user.fullName }`. When a value needs more than one expression, compute it in `data()` and read the field.

## Functions

A function formats a value for display. Call it with the value first; calls nest and go anywhere a value goes.

```html
<span>{ datetime(todo.createdAt, 'short') }</span>
<p>{ currency(price * quantity) }</p>
<p>{ pluralize(comments.length, 'comment') }</p>   <!-- 3 comments -->
<p>{ truncate(capitalize(title), 40) }</p>
<a href={ link('/about') } title={ currency(price) }>…</a>
```

The built-ins: `round`, `currency`, `percentage`, `number_with_delimiter`, `compact_number`, `capitalize`, `truncate`, `strip_html`, `strip_newlines`, `pluralize`, `escape`, `raw`, `newline_to_br`, `json`, `date`, `time`, `datetime` (presets `short`, `medium`, `long`, `iso`), `in_timezone`, `t` (translations), plus `link` (router-aware href) and `timeago`. Each one's contract is in §6.

- What JavaScript already spells is not a function: count with `.length`, do math with the operators and `Math.*`, fall back with `??`, transform text with methods (`.toUpperCase()`, `.trim()`, `.replaceAll(a, b)`, `.split(',')`).
- There is no `|` pipe: `{ price | currency }` is a compile error that says to write `currency(price)`.
- Register your own in the app config — `formatters: { byline: (name) => … }` — and call them the same way: `{ byline(post.author) }`. A function must be pure: rows in a cached `{#for}` do not re-run it.
- A misspelled function doesn't crash: the value renders unchanged and the console names it, with a did-you-mean.

**Rendering HTML.** Every interpolation is text, so a value never becomes markup by accident. `{ raw(post.bodyHtml) }` renders HTML through an allowlist sanitizer (scripts, event handlers, `style` and unsafe URLs are removed); `{ newline_to_br(comment.text) }` turns line breaks into `<br>`. Either must be the outermost call of a text interpolation — not an attribute or a prop.

## Conditionals

```html
{#if todos.length > 0}
  <ul>…</ul>
{:else if loading}
  <p>Loading…</p>
{:else}
  <p>No todos yet — add one above.</p>
{/if}

{#unless user}<a href="/login">Sign in</a>{/unless}

{#case status}
  {:when 'active', 'trial'}<span class="badge-green">Live</span>
  {:when 'suspended'}<span class="badge-red">Suspended</span>
  {:else}<span>Unknown</span>
{/case}
```

`{:else}` comes last. `{#unless}` takes `{:else}` but not `{:else if}`. `{#case}` matches with `===`; commas list alternatives; the first match wins with no fallthrough.

## Runtime component selection: `<Component>`

Choose one of the compiled Puzzle components imported by this file (§67). All candidates are loaded before rendering; there is no runtime module-name lookup.

```html
<script>
import TaskCard from './TaskCard.pzl';
import BacktestCard from './BacktestCard.pzl';
const cards = { task: TaskCard, backtest: BacktestCard };
</script>

<!-- current is a constructor returned by data(); it may also be null -->
<Component is={ current } title={ title } @close={ close }>
  <p>Default content for the selected card</p>
</Component>

<Component is={ cards[embed.type] } {...embed.props} />
```

- **`is` chooses a value.** It must be an imported compiled component constructor; `null`/`undefined` renders nothing. Children become the selected component's normal default slot.
- **Only `is` may read imports and simple script declarations directly.** `is={ TaskCard }` and `is={ cards[key] }` work without returning those bindings from `data()`. Loop/snippet bindings win, then module bindings, then data fields. Destructured bindings need a simple module alias or a value returned by `data()`. Other props, spread operands and child expressions read normal template data.
- Imports and `const` selector bindings preserve cached rows. Mutating a const map's entries in place is not observed by a cached row; a module `let`/`var` selector is re-evaluated on each parent render.
- Props and callback props are reactive as on any component. `name` and `from` are ordinary forwarded props when `is` exists. `{...embed.props}` passes the current object's props; later written attributes override earlier spreads and vice versa. A loop row's resolved key always wins over spreads. `bind:` is unsupported on components; `flip` on `<Component>` is a compile error, so put it on a wrapping keyed element.
- Changing the constructor fully destroys the old instance and descendants before mounting the new one at the same position, with current props. A stable constructor reuses the instance. Removing the tag itself runs the child's ordinary hide hooks and leave transition; only a constructor swap tears it down immediately. Prerender applies the same selection rule to its HTML.
- Missing or non-expression `is`, or a string, number, boolean or template-literal selector inside braces, is a compile error. Nullish selectors are valid. `Component` is a reserved tag/family root: rename a user `Component.pzl` or a tag import named `Component`.

## Loops

```html
{#for todo in filteredTodos, i}
  <li>{ i + 1 }. { todo.text } <button @click={ deleteTodo(todo) }>×</button></li>
{/for}

{#for 1...3, n}<li>Step { n }</li>{/for}
```

- The trailing `, name` is optional: the 0-based index for item loops, the current number for ranges.
- The collection can be any expression (`{#for t in todos.filter(t => !t.done)}`); a list the view reuses or that takes real logic belongs in `data()`.
- Rows are keyed automatically by the record's primary key (or `.id`). Add `key={ … }` on the row root for other data (§28).
- A missing list renders nothing; a non-list renders nothing and warns in development.
- `{#for i in 1...5}` is an error — write `{#for 1...5, i}`.

## Attributes

```html
<!-- inline {#if} and interpolation inside a quoted value -->
<span class="flex-1 {#if todo.completed}line-through text-gray-500{/if}">{ todo.text }</span>
<button title="Delete { todo.text }">×</button>

<!-- brace-only: the value itself -->
<button type="submit" disabled={ !canAdd }>Add</button>
<div class={ [active && 'is-active', 'tab'] }>…</div>
```

A brace-only value controls the attribute: `false`, `null` and `undefined` remove it, `true` writes it empty, and a list becomes space-separated tokens with empty entries dropped. Write `\{` and `\}` for literal braces — `pattern="[0-9]\{5\}"`.

## Two-way form binding

On a plain `<input>`, `<textarea>` or `<select>`, `value={ path }` and `checked={ path }` bind both ways when `path` is a bare name or a one-level path. No handler needed:

```html
<input type="text" placeholder="What needs doing?" value={ newTodoText } />
<input type="checkbox" checked={ todo.completed } />
```

- A bare name writes local state (`setData` + `refresh`, so `data()`-derived values like `canAdd` stay current as you type).
- A path writes its root: a store record through validated `update()`; a plain object is mutated. **Bind the path you want written.**
- Numbers, checkboxes, dates and selects commit on `change`; text fields on `input`.
- Opt out with your own `@input`/`@change`, a non-path expression (`value={ draft ?? '' }`), or static `readonly`. Other events (`@keydown:enter`, `@blur`) coexist with the bind.
- A bound plain object must keep its identity across `data()` runs — hold it in `created()` or `this.memo()`, not a fresh literal each run.

The full trigger conditions and event matrix are in §6.

## Events

```html
<form @submit={ addTodo(event) }>
<button @click={ setFilter('all') }>All</button>
<button @click={ clearCompleted }>Clear</button>
<input @keydown:enter={ addTodo(event) } @keydown:escape:prevent={ cancelEdit } />
<div class="menu" @pointerdown:outside={ closeMenu }>…</div>
```

A bare name gets the DOM event; a call gets exactly the arguments written; modifiers (`prevent`, `stop`, `once`, `outside`, key filters) stack. See [[DOC-EVENTS]] and §5.

## Components

A tag that doesn't start with a lowercase letter is a component, imported in `<script>`. Props are attributes; braces pass values.

```html
<TodoItem todo={ todo } @remove={ deleteTodo(todo) } />
<Übersicht größe={ 3 } />
<Frame><Frame.Wrapper>…</Frame.Wrapper></Frame>
```

When a prop changes, the child's `data(params, props)` re-runs. `@name={ … }` on a component passes a callback prop. Dotted tags are **component families**: a directory of `.pzl` files with an `index.js` barrel (`export default Object.assign(Frame, { Wrapper, Content })`), scaffolded by `puzzle generate component Frame --family Wrapper,Content` (§65). A component without a `<script>` reads its props directly (`{ tone }`).

## Children, slots and snippets

```html
<!-- Card.pzl -->
<puzzle-view>
  <article class="card">
    <header><Slot name="header"/></header>
    <div class="body"><Children>Nothing here yet</Children></div>
  </article>
</puzzle-view>

<!-- a call site -->
<Card>
  <h2 slot="header">{ post.title }</h2>
  <p>{ post.excerpt }</p>
</Card>
```

- `<Children/>` renders the call site's children; `<Slot name="x"/>` renders the children marked `slot="x"`; in a layout, a bare `<Slot/>` is where the routed page goes.
- A paired marker's body is a **fallback**, shown when nothing is supplied — including a `{#for}` over an empty list or a false `{#if}`. Keep a fallback to one root element when siblings follow the marker.
- One default marker per render path; mutually exclusive `{#if}` branches may each have one.
- `<Children/>` inside another component forwards your children (and snippets) through it.
- **Snippets** let a component stamp caller markup per item:

```html
<UserList users={ users }>
  <Snippet user><b>{ user.name }</b></Snippet>
</UserList>

<!-- UserList.pzl -->
<ul>{#for user in users}<li><Children user={ user }>{ user.name }</Children></li>{/for}</ul>
```

Full rules: §24 (markers) and §64 (snippets).

## Islands, refs and inline SVG

```html
<!-- the browser owns the children after mount -->
<div contenteditable="true" island @input={ syncText(event) }>{ block.text }</div>

<!-- this.refs.search is the live element -->
<input ref="search" type="text" />

<!-- an icon from app/assets, inlined at compile time -->
<span class="inline-block size-5">{#svg 'icons/cart.svg'}</span>
```

- `island` (§17): data flows out, never back in; change its `key` to reset it. No components or markers inside.
- `ref="name"` (§38): static, on plain elements only — not on components (use an `@ready` callback prop), not inside `{#for}`, `<Snippet>` or `<puzzle-skeleton>`.
- `{#svg 'path'}` (§18): a static path under `app/assets/`; the file is inert (no template syntax inside). Color it with `currentColor`, size it with a wrapper.

## Comments and raw blocks

```html
{## an inline note }
{#comment}
  Commented-out template code — { anything }, even {#if}broken markup.
{/comment}

<pre>{#raw}const shape = { a: 1 };{/raw}</pre>
<script type="application/json">{#raw}{ "loop": true }{/raw}</script>
```

Comments and HTML comments are removed at compile time. `{#raw}` makes braces literal while HTML inside still parses (§57); it is unrelated to the `raw()` function.

## Whitespace and void elements

- Indentation between tags doesn't leak into the page: whitespace with a line break between two elements disappears; between text and anything else it becomes one space. `<pre>` and `<textarea>` keep their text exactly.
- `br`, `img`, `input` and the other void elements take no closing tag: `<br>`, `<img src="/logo.svg" alt="">`, `<input value={ x } readonly>`. `</input>` is an error.

## Deferred

- Refs inside loops, dynamic `ref`/`slot`/`island` values.
- An unsanitized HTML injection syntax (`{@html expr}`) — use `raw()`.
- Components or markers inside an island.

## Cheat sheet

| Construct | Example |
| --- | --- |
| Interpolation | `{ todo.text }` |
| Function | `{ datetime(todo.createdAt, 'short') }` |
| Method | `{ name.toUpperCase() }`, `{ tags.join(', ') }` |
| Count, math, fallback | `{ tags.length }`, `{ currency(price * qty) }`, `{ nickname ?? name }` |
| Conditional | `{#if a} … {:else if b} … {:else} … {/if}` |
| Inverted | `{#unless todos.length} … {/unless}` |
| Multi-branch | `{#case status}{:when 'a', 'b'} … {:else} … {/case}` |
| Loop | `{#for todo in todos, i} … {/for}`, `{#for 1...3, n} … {/for}` |
| Conditional class | `class="base {#if done}line-through{/if}"` |
| Dynamic attribute | `disabled={ !canAdd }` |
| Two-way binding | `value={ newTodoText }`, `checked={ todo.completed }` |
| Event | `@click={ clearCompleted }`, `@click={ setFilter('all') }` |
| Modifiers | `@keydown:enter:prevent={ save }`, `@pointerdown:outside={ close }` |
| Component | `<TodoItem todo={ todo } @remove={ deleteTodo(todo) } />` |
| Router outlet | `<Slot/>` |
| Children / named slot | `<Children/>`, `<Slot name="header"/>` + `slot="header"` |
| Fallback | `<Children>Nothing here yet</Children>` |
| Snippet | `<Snippet user>{ user.name }</Snippet>` + `<Children user={ user }>` |
| Island / ref / SVG | `<div island>`, `ref="search"`, `{#svg 'icons/cart.svg'}` |
| Comment / raw | `{## note }`, `{#comment}…{/comment}`, `{#raw}…{/raw}` |
