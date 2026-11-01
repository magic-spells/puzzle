---
name: Event handling — user guide
status: verified
verified_at: '2026-11-01T19:25:25.008Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-CODEGEN
  - DOC-SPEC
  - DOC-SPEC-TEMPLATE
  - DOC-TEMPLATE-SYNTAX
  - DOC-PUZZLE-FILE
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Puzzle event handling

How components declare handlers, how templates bind them, how handlers update state, and how components talk to their parents. The contract is [[DOC-SPEC-TEMPLATE]] §5 (forms and modifiers), §31 (handler identity) and §47 (`outside`); the template grammar around `@event={ … }` is [[DOC-TEMPLATE-SYNTAX]]. Examples come from the todos app (`examples/todos/app/views/Home.pzl`).

## The `events` class field

Handlers live in one class field named `events`, an object of **arrow functions**:

```js
export default class TodoHome extends PuzzleView {
  events = {
    addTodo: (event) => {
      event.preventDefault();
      const text = this.getData().newTodoText.trim();
      if (text) {
        this.ctx.store.createRecord('todo', { text });
        this.setData('newTodoText', '');
      }
    },
    setFilter: (filter) => {
      this.setData('currentFilter', filter);
      this.refresh(); // filteredTodos is derived in data()
    },
  };
}
```

- `events` is a class field (`events = { … };`), with no commas between class members.
- **Every handler must be an arrow function.** The runtime calls `this.events.addTodo(event)`, so method shorthand (`addTodo(event) { … }`) gets the `events` object as `this`, and `this.setData(...)` throws when the event fires. The compiler can't catch it; a development build warns at the view's first mount, once per view class, for each non-arrow handler that uses `this`. A shorthand handler that never touches `this` works.

## Binding handlers in templates

Three forms (§5):

| Form | Template | The handler receives |
| --- | --- | --- |
| Bare name | `@click={ clearCompleted }` | the DOM event: `clearCompleted(event)` |
| Call | `@click={ setFilter('all') }` | exactly the arguments written, evaluated when the event fires |
| Conditional | `@pointerdown:outside={ menuOpen ? closeMenu : null }` | as the chosen branch; `null` detaches the listener |

```html
<form @submit={ addTodo(event) }>
<button @click={ setFilter('all') }>All</button>
<button @click={ clearCompleted }>Clear</button>
{#for todo in filteredTodos}
  <TodoItem todo={ todo } @remove={ deleteTodo(todo) } />
{/for}
```

- Write `event` explicitly when the handler needs it; `@click={ setFilter('all') }` passes only `'all'`.
- Loop variables are in scope, so `deleteTodo(todo)` gets that row's record.
- Arguments are ordinary template expressions, and the handler's name always means your `events` entry. A template can't use `this`; it reaches the view through the handler's name.
- Inside a handler, `event.target.value` and `event.target.closest('li')` work as written. If your data has a field named `event`, rename it: a template can't read `event` as data and also use the DOM `event` in a handler.

## Updating state

| Change | Use | Re-runs `data()`? |
| --- | --- | --- |
| Local UI state (a filter, a toggle, draft text) | `this.setData(key, value)` or `this.setData({ … })` | No — re-renders directly |
| Values `data()` derives from local state | `this.setData(…)` then `this.refresh()` | Yes, for this view |
| Shared records | `store.createRecord`, `record.update()`, `record.destroy()` | Yes, on every subscribed view |

- `setData()` is cheap on purpose; it does not re-run store queries. When `data()` computes something from local state (like `filteredTodos` from `currentFilter`), call `this.refresh()` after it.
- A `data()` commit replaces the model, so a view mixing local state and store data reads its local values back in `data()` with `this.getData()`.
- Mutate records through `update()` or the store, not by assigning fields or editing copies: a store mutation re-runs `data()` on every view that queried those records.

```js
events = {
  markAllComplete: () => {
    this.ctx.store.findMany('todo').filter((t) => !t.completed).forEach((t) => t.update({ completed: true }));
    // every view whose data() queried 'todo' re-renders
  },
};
```

## Form binding and your handlers

`value={ … }` and `checked={ … }` on a plain form control bind both ways with no handler ([[DOC-TEMPLATE-SYNTAX]] "Two-way form binding"). How that meets your own handlers:

- **Your `@input` or `@change` wins.** Either one, with any modifiers, means you own the write, and nothing is synthesized:

  ```html
  <input type="number" value={ quantity } @input={ clampQuantity(event) } />
  ```

- **Other events coexist with the bind** — the shape for a field that binds continuously but acts on a key:

  ```html
  <input value={ draft } @keydown:enter={ submitDraft(event) } />
  ```

  ```js
  submitDraft: (event) => {
    const text = this.getData().draft.trim();
    if (!text) return;
    this.ctx.store.createRecord('todo', { text });
    this.setData('draft', ''); // clearing the source clears the field
  },
  ```

- **Edit buffers need a one-way display.** A bound path is live, so every keystroke has already landed and there is nothing to revert on Escape. Keep the display one-way with a non-path expression and commit yourself:

  ```html
  <input value={ String(committedName) }
         @keydown:enter={ commitName(event) }
         @keydown:escape={ cancelEdit } />
  ```

## Modifiers

`@event:modifier[:modifier…]` adjusts dispatch (§5):

| Modifier | Effect |
| --- | --- |
| `prevent` / `stop` | `preventDefault()` / `stopPropagation()` |
| `once` | fires once ever for this binding |
| `outside` | fires only for events outside the element (below) |
| `passive` | native passive listener — cannot cancel the default action |
| `capture` | native capture-phase listener |
| `enter` `escape` `tab` `space` `up` `down` `left` `right` `backspace` `delete` | key filters, keyboard events only |

```html
<input @keydown:enter={ addTodo(event) } @keydown:escape:prevent={ cancelEdit } />
<a @click:prevent:stop={ navigate('/home') }>Home</a>
<button @click:once={ claimReward }>Claim</button>
<div @wheel:passive={ onScroll }>…</div>
```

Order is fixed whatever you write: outside check, key check, once, `preventDefault`, `stopPropagation`, handler — so a non-matching key never prevents the browser's default. For a *sometimes* intercept (Backspace only at the caret's start), write a plain `@keydown` handler that checks and calls `event.preventDefault()` itself. `passive:prevent` is a compile error. Modifiers are DOM-only: any modifier on a component's callback prop is a compile error.

## Outside-dismiss: `:outside`

`@pointerdown:outside={ close }` runs the handler for presses **outside** the element (§47). The listener sits on `document` in the capture phase, so another component's `stopPropagation()` can't swallow it and the click that opens a panel can't close it. Content a `<Portal>` inside the element moved elsewhere still counts as inside. The framework attaches and detaches the listener with the element — no `mounted()`/`destroyed()` bookkeeping.

```html
<div class="relative">
  <button @click={ toggleMenu }>Options ▾</button>
  {#if menuOpen}
    <div class="menu-panel" @pointerdown:outside={ closeMenu }>
      <button @click={ pick('rename') }>Rename</button>
      <button @click={ pick('delete') }>Delete</button>
    </div>
  {/if}
</div>
```

For an always-mounted element, use the conditional form: `@pointerdown:outside={ menuOpen ? closeMenu : null }`. `@click:outside` tolerates touch scrolling better than `pointerdown`; `@focusin:outside` detects focus leaving a widget. Events inside an `<iframe>` never reach the parent document.

## Component events: callbacks down, calls up

`<CustomButton @click={ savePost }>Save</CustomButton>` does not attach `savePost` to any DOM node in the child. It passes it as the callback prop `click` (D16):

1. The user clicks the child's real `<button>`; the child's own listener runs.
2. The child decides (disabled? what payload?) and calls `this.props.click(…)`.
3. `savePost` runs **in the parent** — it's an arrow, so `this` is the parent.

The child gates and shapes; the parent does the work. A child with nothing to add binds the prop straight through: `<button @click={ click(event) }>`. There is no `$emit`, no bubbling and no event bus.

**Handler identity (§31).** A bare handler, or a call whose arguments use only literals, `event` and globals, compiles to one cached function per instance — the child gets the same prop every render and doesn't re-run `data()` for it. Inside a `{#for}`, a call that uses only the loop's own variables (`@remove={ deleteTodo(todo) }`) caches per row. A call that reads other data (`@save={ save(draft) }`) or calls a function is fresh each render, so the child re-runs `data()` each parent render — pass the datum as its own prop and use a bare handler if that matters. When wiring a callback into a long-lived external library, read `this.props.name` at fire time rather than capturing it once.

## Imperative handles: `@ready`

When a parent needs a child's imperative handle (a carousel's `.next()`, a library instance), the child delivers it through a callback prop, conventionally `@ready`, from its `mounted()`:

```html
<TarotCarousel options={ carouselOptions } @ready={ carouselReady }>…</TarotCarousel>
```

```js
events = {
  carouselReady: (carousel) => { this._carousel = carousel; }, // an instance field, not setData
  nextSlide: () => this._carousel?.next(),                      // guard: it arrives after mount
};
```

Expect a new handle after the child remounts. For an element in your **own** template, use `ref="name"` instead (`this.refs.name`, §38); `ref` isn't allowed on component tags.

## Common mistakes

1. **Method shorthand in `events`** — `this` is wrong at event time. Use arrows; development builds warn.
2. **Curried handlers** — `(todo) => () => { … }` returns an unused inner function. Write `(todo) => { … }`; the template call passes the arguments.
3. **Assigning to a variable, a record field, or the object `getData()` returned** — invisible to the renderer. Call `setData` or `record.update()`.
4. **Commas between class members** — `events` is a class field; commas go only between handlers inside it.
