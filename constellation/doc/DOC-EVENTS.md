---
name: EVENTS.md — event handling guide
status: verified
verified_at: '2026-07-17T23:27:05.542Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-CODEGEN
  - DOC-SPEC
  - DOC-TEMPLATE-SYNTAX
  - DOC-PUZZLE-FILE
  - DOC-DECISIONS
---

The `events` class field with the arrow-only rationale (field initializers run at construction with `this` bound to the instance), the two template forms (bare identifier vs call expression per [[DOC-SPEC]] §5), worked todos examples, setData-vs-store-mutation semantics, the component-events sequence (D16), and the common-mistakes list.

# Puzzle Event Handling (v1)

Part of the Puzzle docs — see [[DOC-SPEC]] for the frozen v1 contract.

This guide covers how components declare event handlers, how templates bind to them, and how handlers update state. Examples are drawn from the canonical todos app (`examples/todos/app/views/Home.pzl`). For the template grammar around `@event={ … }`, see [[DOC-TEMPLATE-SYNTAX]].

---

## The `events` class field

Handlers live in a single class field named `events` — an object whose values are **arrow functions**:

```js
import { PuzzleView } from '@magic-spells/puzzle';

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
    },
  };
}
```

Two syntax rules follow from `<scripts>` being real JavaScript (SPEC §4):

- `events` is a **class field** (`events = { ... };`), not an object-literal member — and there are **no commas between class members**.
- Every handler **must be an arrow function**.

### Why class fields + arrows

The combination is what makes `this` reliable:

1. A class field initializer evaluates **during construction**, with `this` bound to the component instance.
2. Arrow functions have no `this` of their own — they capture the surrounding `this` **permanently** at creation.
3. So every handler in the field closes over the instance forever. The runtime's event delegation detaches handlers from the object and calls them later; that cannot break the binding, because it was baked in at construction.

Method shorthand (`addTodo(event) { ... }` inside the object) parses as valid JavaScript, but when the delegated handler fires, `this` is the events object or `undefined` — every `this.setData(...)` call would explode at runtime. Because this failure is silent until an event fires, **the compiler rejects method shorthand in `events` with a build error.**

One implementation note that follows from this design: class fields initialize *after* `super()` returns, so the `PuzzleView` base constructor never reads `this.events`. The runtime reads it lazily at mount time, when wiring template handlers.

## The two template forms (SPEC §5)

Templates bind handlers with `@event={ … }`. There are exactly two forms, one rule each:

| Form | Template | What the handler receives |
| ---- | -------- | ------------------------- |
| Bare identifier | `@click={ clearCompleted }` | Invoked as `clearCompleted(event)` — the DOM event. |
| Call expression | `@click={ setFilter('all') }` | The compiler wraps the expression as `(event) => setFilter('all')`, evaluated **at event time** with `event` in scope. The handler receives exactly the arguments written in the template. |

```html
<form @submit={ addTodo(event) }>
<input @input={ updateNewTodoText(event) } />
<input type="checkbox" @change={ toggleTodo(todo) } />
<button @click={ setFilter('all') }>All</button>
<button @click={ clearCompleted }>Clear</button>
```

Notes on the call-expression form:

- Write `event` explicitly if the handler needs it: `@submit={ addTodo(event) }`. If you write `@click={ setFilter('all') }`, the handler receives only `'all'` — no event object is appended.
- Loop variables are in scope: inside `{#for todo in filteredTodos}`, `@change={ toggleTodo(todo) }` passes that iteration's record.
- The expression is evaluated when the event fires, not at render time.

## Worked examples from the todos app

All of these are from `examples/todos/app/views/Home.pzl`.

**Form submit with `preventDefault` — call form passing `event`:**

```html
<form class="flex flex-col sm:flex-row gap-3" @submit={ addTodo(event) }>
```

```js
events = {
  addTodo: (event) => {
    event.preventDefault();
    const text = this.getData().newTodoText.trim();

    if (text) {
      const store = this.ctx.store;
      store.createRecord('todo', { text });
      this.setData('newTodoText', '');
    }
  },
};
```

**Passing a record from a loop — call form with the loop variable:**

```html
{#for todo in filteredTodos}
  <input type="checkbox" checked={ todo.completed } @change={ toggleTodo(todo) } />
{/for}
```

```js
events = {
  toggleTodo: (todo) => {
    todo.toggle(); // model method: update({ completed: !this.completed, ... })
  },
};
```

**Passing a literal argument — call form with a string:**

```html
<button @click={ setFilter('all') }>All</button>
<button @click={ setFilter('active') }>Active</button>
<button @click={ setFilter('completed') }>Completed</button>
```

```js
events = {
  setFilter: (filter) => {
    this.setData('currentFilter', filter);
  },
};
```

**No arguments needed — bare identifier:**

```html
<button @click={ clearCompleted }>
  Clear Completed ({ completedTodos.length })
</button>
```

```js
events = {
  clearCompleted: () => {
    if (confirm('Clear all completed todos?')) {
      const store = this.ctx.store;
      const completed = store.findMany('todo').filter(t => t.completed);
      completed.forEach(todo => todo.destroy());
    }
  },
};
```

(The bare form still delivers the DOM event as the first argument — `clearCompleted(event)` — this handler simply ignores it.)

## Updating state from handlers

Handlers have two levers, and they behave differently:

### Local state: `this.setData()`

Use `setData` for local UI state — form inputs, toggles, the current filter. It accepts `(key, value)` or an object map:

```js
events = {
  updateNewTodoText: (event) => {
    this.setData('newTodoText', event.target.value);
  },
};
```

**`setData()` does NOT re-trigger `data()`.** It updates the component state directly and re-renders. This is deliberate: it keeps keystroke-level updates cheap and avoids re-running store queries for purely local changes. If a value must be recomputed from other data, compute it in `data()` and change its inputs instead.

Because `data()` re-runs will overwrite the model, a component that mixes local state with store data should read its local values back inside `data()` (as `Home.pzl` does with `this.getData()`), so the local state survives store-driven re-runs.

### Store mutations: reactive by design

Creating, updating, or destroying records inside a handler triggers `data()` re-runs on **every component subscribed to those records** — any component that queried them in its `data()`:

```js
events = {
  markAllComplete: () => {
    const store = this.ctx.store;
    const active = store.findMany('todo').filter(t => !t.completed);
    active.forEach(todo => todo.markComplete());
    // Every component whose data() queried 'todo' re-runs and re-renders.
    // No manual setData needed for store-derived values.
  },
};
```

This is the normal flow for shared data: the handler mutates the store, the store notifies subscribers, `data()` re-runs, the view updates. Don't copy store results into local state with `setData` and mutate the copy — mutate the records.

| Change | Mechanism | Re-runs `data()`? |
| ------ | --------- | ----------------- |
| Local UI state (input text, filter, toggle) | `this.setData(...)` | No — direct state update + re-render |
| Shared records | `store.createRecord` / `record.update()` / `record.destroy()` | Yes — on all subscribed components |

## Common mistakes

**1. Method shorthand in `events`.** Parses, but `this` is wrong at event time; the compiler rejects it with a build error.

```js
// Wrong — build error
events = {
  addTodo(event) {
    this.setData('newTodoText', ''); // `this` would not be the component
  },
};

// Right
events = {
  addTodo: (event) => {
    this.setData('newTodoText', '');
  },
};
```

**2. The curried pattern from older examples.** `(todo) => () => { ... }` is removed. The compiler's call-expression wrapping passes arguments directly — write a plain arrow that takes them:

```js
// Wrong — removed pattern; the handler would receive `todo` and return
// an unused inner function
events = {
  toggleTodo: (todo) => () => {
    todo.toggle();
  },
};

// Right
events = {
  toggleTodo: (todo) => {
    todo.toggle();
  },
};
```

**3. Mutating local variables instead of calling `setData`.** Assigning to a variable (or to a property of the object `getData()` returned) changes nothing on screen — the framework only reacts to `setData` and store mutations:

```js
// Wrong — invisible to the renderer
events = {
  setFilter: (filter) => {
    let currentFilter = this.getData().currentFilter;
    currentFilter = filter; // nothing happens
  },
};

// Right
events = {
  setFilter: (filter) => {
    this.setData('currentFilter', filter);
  },
};
```

**4. Commas between class members.** `events` is a class field; separate it from methods with nothing but whitespace. Commas belong only *inside* the object literal, between handlers.

## Component events: the exact sequence (D16)

When a parent writes `<CustomButton @click={ savePost }>Save</CustomButton>`, the parent's handler is **not** attached to any DOM node inside the child. It's passed to the child as the callback prop `click`, and the flow is:

```
user clicks the real <button> DOM element
        │
        ▼
child's own DOM listener fires          ← the child owns its DOM (D18)
        │
        ▼
child's internal handler runs           ← child's logic: disabled? loading?
        │                                  what payload should the parent get?
        ▼
child calls this.props.click(...)       ← this IS savePost — a reference
        │                                  the parent handed down
        ▼
savePost executes IN THE PARENT         ← arrow class field: `this` is the
                                           parent instance, no matter who calls
```

**Event handling lives in the child; behavior lives in the parent.** The child gates and shapes (a disabled button doesn't fire; a Modal's confirm passes form values instead of a raw DOM event); the parent's function does the actual work with the parent's state. If the child has nothing to add, its template can bind the prop straight through (`<button @click={ click(event) }>` where `click` is the prop) — zero indirection when you don't need it.

There is no `$emit`, no bubbling, no event bus — functions passed down, called up.

### Handler identity (v1.29, D62)

A callback prop whose handler is **data-independent** — the bare form (`@save={ savePost }`) or a call form whose arguments use only literals, `event`, `this.…`, or JS globals — compiles to a **per-instance cached closure**: the child receives the *same function object* on every parent render, so callback props no longer make the child's props shallow-differ, and the child's `data()` re-runs only when a prop really changes ([[DOC-SPEC]] §31).

A call form that captures render data or a loop variable (`@remove={ removeCard(card.id) }`) is still a fresh closure per render — its capture genuinely changes — so a child receiving one re-runs `data()` on each parent render. That's correct, but worth knowing: if a child should *not* re-run per parent render, prefer passing the datum as its own prop and using a bare handler.

One consequence for component authors: if you wire a callback prop into a long-lived external system (a third-party library's event emitter), don't capture `this.props.name` at wiring time — read it at fire time (`(e) => this.props.name?.(e)`), so a parent that later passes a *different* function isn't stuck behind the captured one.

## Imperative handles: the callback-ref idiom (blessed in v1.29)

Puzzle has no ref mechanism — no React `forwardRef`, Vue `defineExpose`, or Svelte `bind:this`. When a child owns something imperative the parent legitimately needs (a carousel's `.next()`, a video element, a third-party widget instance), the blessed pattern is a **ready callback**: the child delivers the handle *up* through an ordinary callback prop, once, when the handle exists.

```html
<!-- parent template -->
<TarotCarousel options={ carouselOptions } @ready={ carouselReady }>…</TarotCarousel>
```

```js
// parent class
events = {
  carouselReady: (carousel) => {
    this._carousel = carousel; // instance field — NOT setData (a DOM node isn't view data)
  },
  nextSlide: () => {
    this._carousel?.next(); // always guard: the handle arrives async
  },
};
```

Conventions that make it work:

- **Name the prop `@ready`** and pass the most useful handle (usually the live element or library instance), once, from the child's `mounted()` (or later, if the underlying library boots asynchronously).
- **Store it on an instance field**, never in `setData` — it isn't render data and must not trigger renders.
- **Guard every use with `?.`** — the handle doesn't exist until the child has mounted and delivered it.
- **Expect re-delivery**: if the child is destroyed and remounted (navigation, keyed replacement), a *new* handle arrives via a new `@ready` call; a parent that outlives the child must not keep driving the old one.

`@ready` is the idiom for **component** handles. For a plain element in your **own** template, use the first-class `ref="name"` attribute (v1.39, D72): `this.refs.name` is the live node — populated before `mounted()`, re-pointed if a keyed replacement swaps the element, `null` while unmounted (same `?.` discipline as `@ready`). See [[DOC-SPEC]] §38 and [[DOC-TEMPLATE-SYNTAX]]. `ref` is deliberately not allowed on component tags — a component's root element is its own business; pass a handle up via `@ready` instead.

## Event modifiers (v1.7, D38)

A DOM event binding can carry `:modifier` suffixes that adjust dispatch declaratively: `@event:modifier[:modifier…]={ handler }`. The handler value stays a plain function — the modifiers are encoded in the vnode key (`@keydown:enter:prevent`), so a modifier-free binding is byte-identical to before.

| Modifier | Effect | Applies to |
| -------- | ------ | ---------- |
| `prevent` | `event.preventDefault()` | any event |
| `stop` | `event.stopPropagation()` | any event |
| `once` | handler fires **once ever** for this binding | any event |
| key filter | handler runs only when the key matches (see map below) | `keydown` / `keyup` / `keypress` only |

**Key-filter map** (`event.key`):

| Modifier | `event.key` |
| -------- | ----------- |
| `enter` | `Enter` |
| `escape` | `Escape` |
| `tab` | `Tab` |
| `space` | `' '` |
| `up` | `ArrowUp` |
| `down` | `ArrowDown` |
| `left` | `ArrowLeft` |
| `right` | `ArrowRight` |
| `backspace` *(v1.13, D45)* | `Backspace` |
| `delete` *(v1.13, D45)* | `Delete` |

**Conditional intercepts don't fit filters.** A handler that should intercept Backspace only *sometimes* (e.g. merge blocks only when the caret is at offset 0) cannot use `:backspace:prevent` — that would swallow ordinary deletion. Write a plain `@keydown` handler that guards and calls `event.preventDefault()` itself; the filters serve the unconditional cases.

```html
<input @keydown:enter={ addTodo(event) } @keydown:escape:prevent={ cancelEdit } />
<a @click:prevent:stop={ navigate('/home') }>Home</a>
<button @click:once={ claimReward }>Claim (once)</button>
```

**Canonical execution order** — modifiers stack, and dispatch always runs them in this order **regardless of how they are written**:

1. **key-gate** — a non-matching key bails immediately, *before* `preventDefault` (so native behavior for other keys is preserved) and *without* spending `once`
2. **once-spend** — mark the binding spent
3. **`preventDefault`**
4. **`stopPropagation`**
5. **handler**

**Once semantics:** `once` fires once *ever* for that binding — the spent-marker survives the per-patch handler swaps the ViewManager performs on re-render (a compile-time wrapper couldn't express this, which is why the wrapping lives in the runtime `withModifiers` path, D18). The marker clears only when the binding is actually removed (attr removed, or nulled via an inline-if), so a later re-add of the same `@event:once` starts fresh.

**Compile errors (not warnings):** unknown modifier, a key filter on a non-keyboard event, a duplicate modifier, more than one key filter, or **any modifier on a component callback prop** (component-tag `@name={...}`, D16 — modifiers apply to DOM events only).

## Deferred event features

None of the following work in v1:

- **`this.$emit` / event dispatch between components** — **rejected for v1 (D16)**: child → parent communication is callback props (see above). Revisitable post-v1 if composition patterns demand it.
- **Global event bus** (`this.$events`) — **Status: Planned — not in v1.** See [[DOC-SPEC]].

## Related documentation

- **[[DOC-TEMPLATE-SYNTAX]]** — full template grammar, including `@event={ … }` binding syntax
- **[[DOC-PUZZLE-FILE]]** — `.pzl` file anatomy, lifecycle hooks, `data()` semantics
- **[[DOC-SPEC]]** — the frozen v1 contract (§4 script rules, §5 handler convention)
