---
name: TEMPLATE_SYNTAX.md — template grammar reference
status: verified
verified_at: '2026-07-22T00:04:06.109Z'
connections:
  - COMPONENT-TEMPLATE-PARSER
  - DOC-SPEC
  - DOC-PUZZLE-FILE
  - DOC-EVENTS
---

# Puzzle Template Syntax (v1)

Part of the Puzzle docs — see [[DOC-SPEC]] for the frozen v1 contract.

This is the complete reference for the template grammar inside a `<puzzle-view>` block. Everything on this page is supported in v1; anything deferred is collected in [Deferred syntax](#deferred-syntax-planned--not-in-v1) at the bottom. Examples are drawn from the canonical todos app (`examples/todos/app/views/Home.pzl` and `examples/todos/app/layouts/Default.pzl`).

For the anatomy of a `.pzl` file (the `<puzzle-view>` / `<script>` / `<style>` blocks), see [[DOC-PUZZLE-FILE]].

---

## Interpolation: `{ expression }`

Single braces evaluate a plain JavaScript expression against the component model (the object returned from `data()`) and render the result as text.

```html
<span class="flex-1 text-gray-900">
  { todo.text }
</span>
```

Any JS expression works — property access, method calls, arithmetic, ternaries:

```html
<div class="text-2xl font-bold text-gray-700">{ activeTodos.length }</div>

<button @click={ clearCompleted }>
  Clear Completed ({ completedTodos.length })
</button>
```

Model getters work too: computed properties defined as plain getters on a `PuzzleModel` class (`get fullName() { ... }`) can be read directly in templates — `{ user.fullName }`.

## Formatters: `{ value | formatter(args) }`

Formatters transform a value for display, Liquid-style. They chain left to right with `|`, and take arguments in parentheses.

```html
<!-- From Home.pzl -->
<span class="text-xs text-gray-400">{ todo.createdAt | date('short') }</span>
```

```html
{ text | trim | capitalize }
{ price | currency('$', 2) }
```

Custom formatters are registered in the `PuzzleApp` config (`formatters: { ... }` in `app.js`) and used the same way; `this.ctx.formatters` exposes the registry if you ever need it in JS.

**Typos don't crash (v1.12, D43).** A formatter name that isn't registered renders the value **unchanged** and logs one `console.error` naming it — `[puzzle] unknown formatter "captialize" — value passed through unchanged (did you mean "capitalize"?)`. Formatters are resolved at render time (custom ones are registered in the app config), so this can't be a compile error — watch the console when a formatter seems to do nothing.

**Formatters are display-only.** Filtering, sorting, and any other data logic belongs in `data()`, not in the template:

```html
<!-- Don't: logic in the template -->
{ users | filter(isActive) | sort('name') }
```

```js
// Do: logic in data()
data(params, props) {
  const users = this.ctx.store.findMany('user');
  return {
    activeUsers: users
      .filter(u => u.isActive)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
```

## Conditionals: `{#if} … {:else} … {/if}`

`{#if expr}` renders its block when the expression is truthy. `{:else}` is optional. Standard JavaScript boolean expressions are allowed.

```html
<!-- From Home.pzl: empty state -->
{#if todos.length > 0}
  <div class="max-h-96 overflow-y-auto">
    <!-- ... todo list ... -->
  </div>
{:else}
  <div class="py-16 px-8 text-center text-gray-500">
    <h3 class="text-lg font-medium text-gray-700 mb-2">No todos yet</h3>
    <p class="text-sm">Add a todo above to get started!</p>
  </div>
{/if}
```

Conditionals nest freely and can guard whole sections:

```html
{#if completedTodos.length > 0}
  <button @click={ clearCompleted }>
    Clear Completed ({ completedTodos.length })
  </button>
{/if}
```

### Chained conditions: `{:else if}` (v1.9, D40)

Branch ladders don't need nesting: any number of `{:else if expr}` clauses may sit between the `{#if}` body and the optional `{:else}`. Each condition is a plain JS expression, exactly like `{#if}`, and `{:else}` must be the last clause.

```html
{#if user.isLoggedIn}
  <p>Welcome back, { user.name }!</p>
{:else if user.isPending}
  <p>Your account is almost ready — check your inbox.</p>
{:else}
  <p>Please sign in to continue.</p>
{/if}
```

It desugars to nested `{#if}` blocks internally, so it behaves identically to writing the nesting by hand. It is spelled `else if` (JavaScript), not `elsif` — `{:elsif}` is a compile error with a did-you-mean. `{:else if}` is **not** allowed inside `{#unless}` or `{#case}`, in attribute-value inline-ifs, or after `{:else}` — each is a positioned compile error.

### Inverted conditional: `{#unless}` (v1.7, D36)

`{#unless expr}` renders its body when `expr` is **falsy** — the mirror of `{#if}`. An optional `{:else}` renders when `expr` is truthy. `expr` is any JS boolean expression.

```html
{#unless todos.length}
  <p class="empty">No todos yet — add one above.</p>
{:else}
  <p>{ todos.length } to go</p>
{/unless}
```

Use it for guard-style templates where `{#if !(…)}` reads awkwardly. It desugars to a negated `{#if}` internally, so it behaves identically otherwise. `{:else if}` inside `{#unless}` is a compile error — write an `{#if} … {:else if} …` ladder instead (unless/else-if chains invert the reader's mental model at every rung).

### Multi-branch: `{#case}` / `{:when}` (v1.7, D37)

`{#case expr}` selects the first `{:when}` clause whose value matches `expr` by strict `===`. List several values in one clause (comma = OR), and add a trailing `{:else}` for the default. There is **no fallthrough** — first match wins — and the case expression is evaluated exactly once.

```html
{#case status}
  {:when 'active', 'trial'}
    <span class="badge badge-green">Live</span>
  {:when 'suspended'}
    <span class="badge badge-red">Suspended</span>
  {:else}
    <span class="badge">Unknown</span>
{/case}
```

Content between `{#case}` and the first `{:when}` must be whitespace only. It is `{#case}` (not `{#switch}`) after Puzzle's Liquid heritage — no `break`/fallthrough semantics.

## Loops: `{#for item in items}` and `{#for 1...n}`

The item form iterates an array from the component model, binding each element to the loop variable:

```html
<!-- From Home.pzl -->
{#for todo in filteredTodos}
  <div class="flex items-center px-6 py-4 border-b border-gray-100">
    <span>{ todo.text }</span>
    <button @click={ deleteTodo(todo) }>×</button>
  </div>
{/for}
```

The loop variable (`todo` here) is available to everything inside the block — interpolations, attribute expressions, and event bindings alike.

The range form repeats a block a fixed number of times, useful for static placeholders:

```html
{#for 1...5}
  <div class="h-4 w-full bg-gray-200 rounded"></div>
{/for}
```

As with formatters, keep filtering and sorting out of the template — build `filteredTodos` in `data()` and loop over the result.

### Loop counter — trailing `, name` (v1.2, D29)

Add a trailing `, name` to the header to bind the **loop counter** — the 0-based index of the current item:

```html
{#for todo in filteredTodos, i}
  <div class="flex items-center px-6 py-4 border-b border-gray-100">
    <span class="w-6 text-gray-400">{ i }</span>
    <span>{ todo.text }</span>
    <button @click={ moveUp(i) }>↑</button>
  </div>
{/for}
```

The counter (`i` here) is in scope everywhere in the block, exactly like the item variable. Keying is unchanged — the item form still keys on `todo.id`.

The range form takes the same trailing `, name`, which binds the current number (the range start through its end):

```html
{#for 1...3, n}
  <li class="step">Step { n }</li>
{/for}
```

Both counter bindings are optional and additive — `{#for todo in filteredTodos}` and `{#for 1...5}` are unchanged. The tail is only read as a counter when it is a bare identifier, so a collection expression with commas inside parens or brackets is left alone.

## Interpolation and `{#if}` inside attribute values

Both `{ expression }` and inline `{#if}` blocks work inside attribute value strings. This is the idiomatic way to apply conditional Tailwind classes — mix static utilities with a conditional tail:

```html
<!-- From Home.pzl: filter tab highlights when active -->
<button
  class="flex-1 py-4 px-4 font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors {#if currentFilter === 'all'}bg-white text-indigo-600 border-b-2 border-indigo-600{/if}"
  @click={ setFilter('all') }>
  All
</button>
```

```html
<!-- From Home.pzl: completed todos get struck through -->
<span class="flex-1 text-gray-900 {#if todo.completed}line-through text-gray-500{/if}">
  { todo.text }
</span>

<div class="w-5 h-5 border-2 border-gray-300 rounded transition-all {#if todo.completed}bg-indigo-500 border-indigo-500{/if}"></div>
```

Plain interpolation inside attributes works the same way: `title="Delete { todo.text }"`.

## Dynamic attributes: `disabled={ expr }`, `checked={ expr }`

Bind an attribute to an expression by using braces as the entire attribute value. Boolean attributes toggle on/off with the truthiness of the expression:

```html
<!-- From Home.pzl: submit disabled until there's input -->
<button
  type="submit"
  class="px-6 py-3 bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg"
  disabled={ !newTodoText.trim() }>
  Add Todo
</button>
```

```html
<!-- From Home.pzl: checkbox reflects the record -->
<input
  type="checkbox"
  checked={ todo.completed }
  @change={ toggleTodo(todo) } />
```

Any attribute can be bound this way, not just booleans.

## Controlled form values: `value={ var }`

On form inputs, `value={ variable }` keeps the DOM property synchronized from component data. Puzzle does not infer the write-back expression: pair it with an `@input` handler that updates local or store state, keeping application data as the source of truth:

```html
<!-- From Home.pzl -->
<input
  type="text"
  placeholder="Add a new todo..."
  value={ newTodoText }
  @input={ updateNewTodoText(event) } />
```

```js
events = {
  updateNewTodoText: (event) => {
    this.setData('newTodoText', event.target.value);
  },
};
```

Because `setData()` updates the component state directly (without re-running `data()`), this stays cheap on every keystroke.

## Event bindings: `@event={ … }`

Attach handlers with `@` followed by the DOM event name. Two forms:

1. **Bare identifier** — `@click={ clearCompleted }` — the handler is invoked as `clearCompleted(event)`.
2. **Call expression** — `@click={ setFilter('all') }` or `@submit={ addTodo(event) }` — the compiler wraps the expression as `(event) => setFilter('all')`, evaluated at event time with `event` in scope. The handler receives exactly the arguments written in the template.

```html
<!-- From Home.pzl -->
<form @submit={ addTodo(event) }>
<input type="checkbox" @change={ toggleTodo(todo) } />
<button @click={ setFilter('all') }>All</button>
<button @click={ clearCompleted }>Clear</button>
```

Handlers live in the `events` class field of the component (arrow functions only). See [[DOC-EVENTS]] for the full guide — handler declaration rules, `this` binding, state updates, and common mistakes.

## Component tags with props

Capitalized tags render child components. The component must be imported inside the `<script>` block; props are passed as attributes, with braces for dynamic values:

```html
<puzzle-view class="user-page">
  <UserProfile userId={selectedUserId} />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import UserProfile from '../components/UserProfile.pzl';

export default class UserPage extends PuzzleView {
  data(params, props) {
    return {
      selectedUserId: params.id,
    };
  }
}
</script>
```

Props are fully reactive: when the parent's model changes a prop value, the child's `data(params, props)` re-runs with the new props. Inside a `{#for}` block you can pass the loop variable as a prop: `<TodoItem todo={todo} />`.

## `<Slot/>` in layouts

Inside a layout component, `<Slot/>` marks where the routed view renders. A route's `layout` wraps its `view`; the layout template positions the view with a single self-closing `<Slot/>`:

```html
<!-- From layouts/Default.pzl -->
<puzzle-view class="min-h-screen flex flex-col">
  <header class="py-8">
    <h1 class="text-4xl font-bold text-center">Puzzle Todos</h1>
  </header>

  <main class="flex-1 py-12">
    <div class="max-w-2xl mx-auto px-5">
      <Slot/>
    </div>
  </main>

  <footer class="py-6">
    <p class="text-center text-sm">Made with Puzzle Framework</p>
  </footer>
</puzzle-view>
```

`<Slot/>` and `<children/>` are the **same marker** under one mechanism, split by convention (v1.41, D74): `<Slot/>` (capitalized, bare) is the canonical spelling for the **router outlet** in routed views/layouts, while `<children/>` is the **default marker** in reusable components — children written at a component's call site (`<Button>Save</Button>`) render at that component's `<children/>` (D16). The bare lowercase `<slot/>` is retired: it is now a positioned compile error steering to `<children/>` (call-site children) or `<Slot/>` (router outlet). `<children/>` may carry **fallback children** (`<children><p>empty</p></children>`), rendered when the call site supplies nothing. **Named slots** (`<slot name="…">`) add multiple insertion points — see the next section.

---

## Named slots (v1.21, D53)

Multi-region components — a card with a header/body/footer, a modal with a title/body/actions — declare **named slots** alongside the default one. Shipped in v1.21 (D53); see [[DOC-SPEC]] §24.

**Child side.** `<slot name="header">…fallback…</slot>` declares a named region — `name` is now **required** (v1.41, D74). The fallback body uses the full template grammar and renders when the call site fills nothing for that name; a self-closing `<slot name="footer"/>` has no fallback. The `<children/>` marker is the **default** region.

```html
<!-- Card.pzl -->
<puzzle-view class="card">
  <header><slot name="header">Untitled</slot></header>
  <div class="body"><children/></div>
  <footer><slot name="footer"/></footer>
</puzzle-view>
```

**Call site.** A **static** `slot="name"` attribute on a **direct child** (element or component tag) of a component invocation routes that child into the matching region; the attribute is stripped from the rendered DOM. Direct children without a `slot` attr form the default content, exactly as before. Multiple children may target the same region.

```html
<Card>
  <h2 slot="header">{ post.title }</h2>
  <p>{ post.excerpt }</p>            <!-- no slot attr → default content → <children/> -->
  <Button slot="footer" @click={ open }>Read</Button>
</Card>
```

- **`name` must be static, non-empty, and unique per template.** `name="default"` and `name="children"` are reserved — `<children/>` IS the default (both are compile errors, the latter steering to `<children/>`). A `<puzzle-skeleton>` body is a separate template, so the same name may appear once in each.
- **Direct-child rule.** `slot` targeting is honored only on a **direct child** of the component tag. Anywhere else — a child of a plain element, or deeper — `slot` is the ordinary HTML global attribute and passes through untouched.
- **Views/layouts.** The router only ever fills the DEFAULT slot, so a named slot in a routed view's or layout's template just renders its fallback. Scoped slots (child data flowing back into parent-provided content) remain deferred.

**Compile errors:** a dynamic `slot={ expr }` on a direct component child; a control-flow block (`{#if}`/`{#unless}`/`{#for}`/`{#case}`) at direct-child level whose top-level nodes carry `slot` attrs (put the condition **inside** the slotted element instead); on the child side, a non-static/interpolated `name`, an empty `name`, `name="default"`, a non-`name` attribute on `<slot>`, or a duplicate slot name within one template.

---

## DOM islands: the `island` attribute (v1.13, D44)

A bare static `island` attribute on a **plain element** hands its children to the browser after mount. The template children render **once**, as seed content (full grammar available); after that the patcher never reconciles them — external mutations (a `contenteditable` user edit, a chart library's DOM) survive every re-render. The element's own attributes and listeners keep patching normally, and the attribute itself never reaches the DOM (stripped like `key`).

```html
<!-- An always-editable text block: the framework seeds it, the browser owns it -->
<div contenteditable="true" island
     @input={ syncText(event) }
     @keydown:enter:prevent={ splitBlock(event) }>{ block.text }</div>

<!-- A third-party mount: seeded empty, filled by a chart library in mounted() -->
<div class="h-64" island></div>
```

Data flows **out of** an island (events → store), never back in. To programmatically reset one, change its `key` — a tag or key change replaces the node and re-seeds from the template.

**Compile errors:** `island={ expr }` (must be static); `island` on a component tag; a component or composition marker (`<children/>`/`<Slot/>`/`<slot name>`) inside an island subtree; `island` on the `<puzzle-view>` root. See [[DOC-SPEC]] §17 for the full semantics and rationale.

---

## Inline SVG: `{#svg 'path'}` (v1.14, D46)

Inlines an SVG file from **`app/assets/`** at compile time — the Shopify-snippet ergonomic for a shared icon set. The framework's first **void block tag**: self-contained, no `{/svg}`.

```html
<button class="group text-gray-500 hover:text-red-500" @click={ toggleCart }>
  <span class="inline-block size-5">{#svg 'icons/cart.svg'}</span>
</button>
```

The header is exactly one quoted **static** path (single or double quotes), resolved from `app/assets/` — `'icons/cart.svg'` is `app/assets/icons/cart.svg`. The tag takes nothing else: no attributes, no dynamic paths, no children. Style icons via the parent — `currentColor` in the file picks up the parent's text color (hover states included), and sizing comes from a wrapper `<span class="size-5">`, a `[&_svg]:size-5` child selector, or width/height in the file.

**The file is inert.** Its contents are dropped in verbatim (island semantics — seeded once, never diffed, zero per-patch cost) and are never template-parsed: no `{ expr }`, blocks, or `@event` handlers inside the file. For a reactive or animated SVG, paste the markup directly into the template — arbitrary inline SVG has always worked.

**Compile errors:** unquoted/dynamic/missing path; anything after the path; a stray `{/svg}`; absolute or `./`/`../` paths; missing file or `app/assets/` dir; a file whose root element isn't `<svg>`. See [[DOC-SPEC]] §18.

---

## Element refs: `ref="name"` (v1.39, D72)

A static `ref="name"` on a plain element hands the view a live reference to that DOM node as `this.refs.name` — the declarative replacement for `this.element.querySelector(...)`:

```html
<puzzle-view class="chart-card">
  <svg island ref="scene" viewBox="0 0 100 40" class="w-full"></svg>
  <input ref="search" type="text" @input={ filter(event) } />
</puzzle-view>
```

```js
mounted() {
  this.refs.search.focus();              // populated before mounted() — no guard needed here
  this.#raf = requestAnimationFrame(this.#tick); // island + ref: the zero-diff animation combo
}
events = {
  jumpToSearch: () => this.refs.search?.focus(), // outside mounted(): guard with ?.
};
```

The framework keeps the reference honest: if a keyed replacement swaps the element, `this.refs.name` re-points to the **new** node; when the element unmounts (an `{#if}` turning off, a list row leaving), it becomes `null`, and it repopulates on re-entry. The `ref` attribute itself never reaches the DOM (stripped like `key` and `island`).

Rules: the name must be a bare identifier (it becomes `this.refs.<name>`); the value must be a static string — `ref={ expr }` is a compile error. Not allowed on component tags (use the `@ready` callback prop — see [[DOC-EVENTS]]), on `<slot>`, on the `<puzzle-view>` root (that's already `this.element`), inside `{#for}` (array refs are deferred), or inside `<puzzle-skeleton>`. Duplicate names in one template are a compile error. `refs` is a framework-owned field — read it, never assign it, and don't put DOM nodes in `setData` (they aren't render data).

---

## Comments: `{## }` and `{#comment}…{/comment}` (v1.37, D70)

Comments are erased at compile time — no DOM node, nothing in the bundle. Three ways to write one:

```html
{## inline note — everything to the closing brace is discarded }

{#comment}
  A block comment. The body is discarded RAW, so it can hold anything —
  { interpolations }, {#if}broken{/if} half-written blocks, even other
  {#comment}comment blocks{/comment} — none of it is parsed.
{/comment}

<!-- HTML comments are ALSO stripped at compile time (they never reach the DOM) -->
```

**Inline `{## … }`.** Everything after `{##` up to the matching `}` is comment content. The scanner tracks brace nesting — `{## { user.name } }` is one comment — and it is *not* string-aware, so apostrophes are fine (`{## don't render this yet }`). A lone unbalanced `}` needs a backslash escape: `{## a \} brace }`.

**Block `{#comment} … {/comment}`.** The body is never lexed, which is the point: comment out broken or half-written template code and it just disappears. Blocks nest (a commented-out region may contain another `{#comment}`), the closer tolerates whitespace (`{/ comment }`), and anything after the keyword in the opener (`{#comment temp disabled}`) is ignored.

Comments are legal at any **text** position — between `{:when}` clauses, next to `{:else}`, inside `{#for}` bodies, in `<puzzle-skeleton>` bodies. They are **not** allowed inside attribute values (`class="{## no }"` is a positioned compile error), and an unclosed `{##` / unterminated `{#comment}` errors at the opening brace.

One Tailwind caveat (true of HTML comments too, and of Tailwind everywhere): its scanner reads raw source text, so an English word in a comment that happens to be a utility name (`block`, `inline`, `flex`, …) can pull that utility into `styles.css`. The JS bundle is unaffected — comments never reach it.

---

## Deferred syntax

These boundaries are deliberate and remain unshipped:

- scoped slots (child data passed into parent-authored slot content);
- array refs or refs inside loops;
- dynamic `ref`, `slot`, or `island` names;
- raw HTML injection syntax;
- components or composition markers inside an island subtree.

Previously deferred named slots, skeletons, `{#unless}`, `{#case}`, event
modifiers, and `{:else if}` are shipped and documented above.

---

## Cheat sheet

| Construct | Syntax | Example |
| --------- | ------ | ------- |
| Interpolation | `{ expr }` | `{ todo.text }` |
| Formatter | `{ value \| fmt(args) }` | `{ todo.createdAt \| date('short') }` |
| Formatter chain | `{ value \| fmt \| fmt2 }` | `{ text \| trim \| capitalize }` |
| Conditional | `{#if expr} … {:else} … {/if}` | `{#if todos.length > 0} … {:else} … {/if}` |
| Conditional chain | `{#if a} … {:else if b} … {:else} … {/if}` | `{#if user.isLoggedIn} … {:else if user.isPending} … {/if}` |
| Inverted conditional | `{#unless expr} … {:else} … {/unless}` | `{#unless todos.length} … {/unless}` |
| Multi-branch | `{#case expr}{:when v1, v2} … {:else} … {/case}` | `{#case status}{:when 'active'} … {/case}` |
| Loop (items) | `{#for item in items} … {/for}` | `{#for todo in filteredTodos} … {/for}` |
| Loop (range) | `{#for 1...n} … {/for}` | `{#for 1...5} … {/for}` |
| Loop (items + counter) | `{#for item in items, i} … {/for}` | `{#for todo in filteredTodos, i} … {/for}` |
| Loop (range + counter) | `{#for 1...n, x} … {/for}` | `{#for 1...3, n} … {/for}` |
| Attr interpolation | `attr="text { expr }"` | `title="Delete { todo.text }"` |
| Conditional classes | `class="base {#if expr}extra{/if}"` | `class="text-gray-900 {#if todo.completed}line-through{/if}"` |
| Dynamic attribute | `attr={ expr }` | `disabled={ !newTodoText.trim() }`, `checked={ todo.completed }` |
| Two-way input | `value={ var }` | `value={ newTodoText }` |
| Event (bare) | `@event={ handler }` | `@click={ clearCompleted }` |
| Event (call) | `@event={ handler(args) }` | `@click={ setFilter('all') }`, `@submit={ addTodo(event) }` |
| Event + modifiers | `@event:mod[:mod]={ handler }` | `@keydown:enter={ addTodo(event) }`, `@click:prevent:stop={ nav }` |
| Component + props | `<Name prop={ expr } />` | `<UserProfile userId={selectedUserId} />` |
| Router outlet (view/layout) | `<Slot/>` | `<main><Slot/></main>` |
| Default marker (component children) | `<children/>` (optional fallback) | `<div class="body"><children/></div>` |
| Named slot (child) | `<slot name="…">fallback</slot>` (`name` required) | `<header><slot name="header">Untitled</slot></header>` |
| Named slot (call site) | `<el slot="…">` on a direct component child | `<h2 slot="header">{ title }</h2>` |
| DOM island | `<el island>seed</el>` | `<div contenteditable="true" island>{ block.text }</div>` |
| Inline SVG | `{#svg 'path'}` (void — no closer) | `<span class="size-5">{#svg 'icons/cart.svg'}</span>` |
| Element ref | `ref="name"` → `this.refs.name` | `<canvas ref="chart"></canvas>` |
| Comment (inline) | `{## text }` | `{## TODO: swap for real data }` |
| Comment (block) | `{#comment} … {/comment}` (body raw — can wrap broken markup) | `{#comment}{#if wip}…{/comment}` |

## Related documentation

- **[[DOC-EVENTS]]** — full event-handling guide
- **[[DOC-PUZZLE-FILE]]** — `.pzl` file anatomy and lifecycle
- **[[DOC-SPEC]]** — the frozen v1 contract (wins on any conflict)
