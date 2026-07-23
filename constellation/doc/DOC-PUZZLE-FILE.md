---
name: PUZZLE_FILE.md — .pzl component reference
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
  - DOC-DECISIONS
  - DOC-USER-GUIDE
  - DOC-DATASTORE
  - DOC-COMPILATION-FLOW
---

Single-file component anatomy: the four blocks (template, optional skeleton, scripts, styles), the class contract table (data/events/lifecycle/animations), the real-JS rules, the v1 ctx surface (store/router/formatters exactly), and styles-block semantics.

# Puzzle Single-File Components (.pzl)

Puzzle components bundle template, logic, and optional styles inside a single `.pzl` file. This document lists the supported blocks, lifecycle hooks, and runtime contracts so you can author components without memorising compiler internals.

---

## File Anatomy

Each `.pzl` file can contain up to four top-level blocks:

```html
<puzzle-view class="my-component" id="unique-id" data-custom="value">
  <!-- Markup + Puzzle directives -->
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import OtherComponent from './OtherComponent.pzl';

export default class ComponentName extends PuzzleView {
  // component definition (see below)
}
</script>

<style>
/* Optional global CSS */
</style>
```

- `<puzzle-view>`: The web component root with any HTML attributes (class, id, data-*, etc.) and Puzzle directives (`{}` interpolations, `#if`, `#for`, etc.).
- `<puzzle-skeleton>`: Optional loading template (v1.8, D39) shown while the first `data()` is pending, then swapped for the real template (see [Skeleton Loading States](#skeleton-loading-states)).
- `<script>`: Class extending PuzzleView with component logic and lifecycle. Imports — including other `.pzl` components — live inside this block, where esbuild resolves them.
- `<style>`: Optional CSS, emitted as global CSS. A bare `scoped` attribute confines the block to the component (v1.27, D59 — see [Styles Block](#styles-block)).

Only the `<puzzle-view>` block is required.

**Emission modes (D20):** files under `app/views/**` and `app/layouts/**` compile to a real `<puzzle-view>` DOM element carrying the tag's attributes; **reusable components render inline** — no wrapper element, template contents only — so nested components never stack wrappers. For components, `<puzzle-view>` is just the template delimiter: it must carry no attributes (compile error) and the template needs a single root element in v1. See [[DOC-SPEC]] §3 and [[DOC-DECISIONS]] D20.

---

## `<script>` Block

The contents of `<script>` must parse as **standard JavaScript** — no custom dialect. The compiler hands the block to esbuild untouched, so editors, ESLint, and Prettier work with zero special tooling. Concretely: `events` and `animations` are **class fields** (`events = { ... };`), not object-literal members, and there are **no commas between class members**.

Because esbuild owns module resolution, **JSON imports just work**: `import config from './config.json'` in a `<script>` block yields a real JS object via esbuild's built-in JSON loader — no config, no `<script>`-tag tricks. (SVG files are different: they're inlined into templates via `{#svg 'path'}` — see [[DOC-TEMPLATE-SYNTAX]] and [[DOC-SPEC]] §18 — not imported in `<script>`.)

Imports may be relative or use the built-in **`@` alias for your `app/` directory** (v1.42, D75): `import Icon from '@/components/Icon.pzl'` resolves the same from any depth, which beats `../../components/Icon.pzl` once views are nested. Always on, no configuration; scoped packages like `@magic-spells/puzzle` are unaffected. See [[DOC-SPEC]] §40.

The class exported from `<script>` extends `PuzzleView` and supports the following:

| Property      | Type                    | Purpose |
| ------------- | ----------------------- | ------- |
| Class Methods | Regular functions       | Helper methods called internally by lifecycle or other methods.
| `events`      | Class field: object of arrow functions | DOM event handlers bound to template actions. Arrow functions only.
| `animations`  | Class field: `{ in?, out? }` | Declarative enter/leave animations via the Web Animations API (v1.1). Each spec is `{ from, to, duration, easing?, delay? }`. See [[DOC-SPEC]] §12.
| Lifecycle     | `created`, `mounted`, `beforeUpdate`, `afterUpdate`, `destroyed`, plus `viewWillShow`/`viewDidShow`/`viewWillHide`/`viewDidHide` (v1.1, around enter/leave animations) | Optional hooks executed during the view lifecycle.
| `data`        | Method `(params, props)`, may be `async` | Return a plain object representing the component's model. Runs on mount and when subscribed store data changes.

### Event Handlers

Handlers are declared in the `events` class field and exposed directly to templates. Handlers **must be arrow functions**: a class field initializer evaluates during construction with `this` bound to the instance, so arrows in the field permanently capture the component as `this` — detaching the handler (as event delegation does) cannot break it. Method shorthand (`addTodo(event) { ... }`) parses but binds `this` to the events object or `undefined`, so the compiler rejects it with a build error.

Templates reference handlers in two forms:

1. **Bare identifier** — `@click={ clearCompleted }` → the handler is invoked as `clearCompleted(event)`.
2. **Call expression** — `@click={ setFilter('all') }` or `@submit={ addTodo(event) }` → the compiler wraps the expression as `(event) => setFilter('all')`, evaluated at event time with `event` in scope. The handler receives exactly the arguments written in the template.

```html
<form @submit={ addTodo(event) }>
<input type="checkbox" @change={ toggleTodo(todo) } />
<button @click={ setFilter('all') }>All</button>
<button @click={ clearCompleted }>Clear</button>
```

```js
events = {
  addTodo: (event) => {
    event.preventDefault();
    // ...
  },
  toggleTodo: (todo) => {
    todo.toggle();
  },
  setFilter: (filter) => {
    this.setData('currentFilter', filter);
  },
  clearCompleted: () => {
    // ...
  },
};
```

Event modifiers — `@event:modifier[:modifier…]={ handler }` (`prevent`/`stop`/`once` + key filters like `@keydown:enter`) — **shipped in v1.7 (D38)**. See [[DOC-SPEC]] §5 and [[DOC-EVENTS]].

### Lifecycle Hooks

Hooks execute in this order:

1. `created()` — runs once after instance creation but before initial render.
2. `mounted()` — runs after the DOM is first rendered.
3. `beforeUpdate()` / `afterUpdate()` — run around subsequent updates.
4. `destroyed()` — runs when the instance is torn down.

All hooks run with `this` bound to the component instance and have access to `this.ctx.store`, `this.ctx.router`, and `this.ctx.formatters` provided by the `PuzzleView` base class.

### Runtime Context

Puzzle injects a runtime context into every view/component instance as `this.ctx`. It exposes exactly three services:

- `this.ctx.store` — shared data store for querying and updating records.
- `this.ctx.router` — router instance for navigation (`this.ctx.router.push('/home')`).
- `this.ctx.formatters` — formatter registry (rarely used directly).

That's the entire v1 context surface — intentionally minimal.

An extended surface (`this.$app`, `this.$store`, `this.$router`, `this.$formatters`, `this.$route`, a `this.$events` global event bus, and a `ctx.utils` helper namespace) has been discussed in older docs. **Status: Planned — not in v1.** See [[DOC-SPEC]].

### Data Flow & Component State

Puzzle has a clear data hierarchy with distinct responsibilities:

- **Store** = "What data exists in the app?" (Global state shared across components)
- **data()** = "What does THIS component need?" (Component model/state definition)
- **SetData** = "Update THIS component's state" (Local state changes)

#### The `data()` Method

The `data(params, props)` method is the **heart of component reactivity**. It defines what data the component needs and how it should be structured.

**When data() runs:**
1. **Component mounts** - Initial call with route params and props
2. **Props change** - Parent updates props passed to this component
3. **Route params change** - Navigation updates URL parameters
4. **Subscribed store data changes** - Any queried store records are updated

The method returns a plain object that becomes the component's model/state.

**Supports async/await:**
```js
async data(params, props) {
  // Wait for data before rendering
  const user = await this.ctx.store.findOne('user', params.id)
  const posts = await this.ctx.store.findMany('post', { userId: params.id })

  return { user, posts }
}
```

**Auto-subscribes to store queries:**
Any store query in `data()` automatically subscribes the component to updates. When store data changes, `data()` re-runs.

**Props are reactive:**
When a parent component updates props passed to a child, the child's `data()` method re-runs with the new props. This ensures components stay in sync with their parents.

**Example of prop reactivity:**
```js
// Parent component
data() {
  return {
    selectedUserId: 123
  }
}

// Parent template
<UserProfile userId={selectedUserId} />

// UserProfile.pzl - data() runs whenever userId prop changes
data(params, props) {
  return {
    user: this.ctx.store.findOne('user', props.userId)
  }
}

// When parent updates selectedUserId to 456:
// 1. UserProfile receives new props
// 2. data() re-runs with props.userId = 456
// 3. Component re-renders with new user data
```

#### Local State Updates
- `this.setData(key, value)` — update reactive data programmatically after the model has been initialised. Accepts either `(key, value)` or an object map.
- `this.subscribe(record)` / `this.unsubscribe(record)` — manually manage store subscriptions when needed (handled automatically when `setData` receives `Record` instances).

```js
data(params, props) {
  const store = this.ctx.store  // Global store data
  const todos = store.findMany('todo')  // Automatically subscribes to changes

  return {
    loading: false,    // Local component state
    todos,            // Store data (global)
    remaining: todos.filter(todo => !todo.completed).length  // Computed from store
  }
}

// Later in event handlers:
events = {
  addTodo: (event) => {
    // Update global store
    const store = this.ctx.store
    store.createRecord('todo', { title: 'New todo', completed: false })
    // data() automatically re-runs and updates component
  },

  toggleLoading: (event) => {
    // Update local component state only
    this.setData('loading', !this.getData().loading)
  },
};
```

---

## Template Runtime Contract

The compiler converts the `<puzzle-view>` template into an internal render function that Puzzle runs with:

- `params` — data returned from `data()` merged with event handlers and a `ctx` property.
- `params.ctx` — the same context object exposed on `this.ctx`.

When you provide a `data(params, props)` method in the `<script>` export, Puzzle invokes it to collect the model for the component. Return a plain object from `data()`; Puzzle persists the object, makes it available to the template, and re-runs `data()` whenever subscribed records change. You can still call `this.setData()` elsewhere (e.g. inside event handlers) for incremental updates, but `data()` itself should return the definitive model shape.

---

## Styles Block

- `<style>` — in v1, styles are emitted as global CSS, applied as-is. v1 styling is Tailwind-first via utility classes.
- `<style scoped>` — **Shipped in v1.27 (D59).** See [[DOC-SPEC]] §29. A bare `scoped` attribute (the only attribute `<style>` accepts) confines the block to this component's own rendered subtree: the compiler stamps one `data-<scopeId>` attribute on the template root and wraps the verbatim CSS in a native `@scope ([data-<scopeId>]) { … }` rule (it never parses your selectors). A valued/dynamic `scoped`, or any other attribute, is a compile error. Rules still cascade into nested child components like ordinary CSS; a `<style>` block without the attribute emits global CSS, byte-identically to before.
  ```html
  <puzzle-view class="card"><h2>{ title }</h2></puzzle-view>
  <style scoped> h2 { color: rebeccapurple; } </style>
  ```
- At most one `<style>` block per file; combine styles into one block.

---

## Skeleton Loading States

**Status: shipped in v1.8 (D39).** See [[DOC-SPEC]] §16 for the full contract.

`<puzzle-skeleton>` is an optional **top-level section** — a sibling of `<puzzle-view>`, not a tag inside it. Its content renders while the component's **first `data()`** is pending, then swaps for the real template when the data commits. There is no loading flag to manage and no API to call: declare the section and Puzzle handles the timing.

#### Basic Usage

```html
<puzzle-view class="post-list">
  {#for post in posts}
    <PostCard post={post} />
  {/for}
</puzzle-view>

<puzzle-skeleton>
  {#for 1...3}
    <div class="card border p-4 rounded-md animate-pulse">
      <div class="flex items-center gap-3 mb-3">
        <div class="bg-skeleton w-8 h-8 rounded-full"></div>
        <div class="bg-skeleton h-4 w-1/3"></div>
      </div>
      <div class="bg-skeleton h-5 w-full mb-2"></div>
      <div class="bg-skeleton h-4 w-4/5"></div>
    </div>
  {/for}
</puzzle-skeleton>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import PostCard from '../components/PostCard.pzl';

export default class PostList extends PuzzleView {
  async data() {
    // While this await is pending, the skeleton is on screen.
    const posts = await this.ctx.store.findMany('post');
    return { posts };
  }
}
</script>
```

#### Rules

- **At most one** `<puzzle-skeleton>` per file. Its only legal attribute is `min-duration` (v1.20, D52 — see [Anti-flash hold](#anti-flash-hold-min-duration) below); any other attribute, a dynamic/interpolated value, or a malformed number is a compile error. In view/layout mode the skeleton renders under the same `<puzzle-view>` root — and the same attributes — as the real template, so the swap patches children only.
- **Component mode (D20):** like the template, the skeleton needs a **single root element**, and it must be a plain element (a component root is a compile error). Keep its tag equal to the template root's for an in-place swap.
- The body supports the **full template grammar** — the range loop `{#for 1...n}` is the idiomatic way to repeat placeholder rows — but **only `created()`-seeded state is readable** during the skeleton render: `data()` hasn't resolved, so the component model is empty.
- A **synchronous (or already-resolved) `data()` never shows the skeleton**; a later refresh (store change, prop/param change) keeps the current content on screen — the skeleton is a first-load affordance, not a spinner.
- **Routed views with a skeleton commit navigation immediately** (the one D19 amendment): the URL moves, the skeleton paints, and content patches in when `data()` resolves. Views without a skeleton keep the await-then-commit behavior. See [[DOC-ROUTER]].

Lifecycle detail: `mounted()` fires once the **skeleton** is in the DOM; the loaded swap is bracketed by `beforeUpdate`/`afterUpdate` like any update, and a declared `in` animation plays on the skeleton (the swap patches the same root in place). The `view.loaded` getter reports whether the first `data()` has committed (v1.20, D52: it flips at *swap* time, so it stays `false` during an anti-flash hold).

#### Anti-flash hold (`min-duration`)

Fast-but-not-instant data can make the skeleton flash: it appears for a few frames, then vanishes — noise, not feedback. `min-duration` (v1.20, D52) sets a floor, in milliseconds, on how long the skeleton stays up **once it has appeared**:

```html
<puzzle-skeleton min-duration="300">
  <div class="animate-pulse">…</div>
</puzzle-skeleton>
```

- The value is a **static, non-negative integer** (ms). It is the section's **only** attribute; a dynamic value (`min-duration={ms}`), any other attribute, or a bad number is a compile error. Absent (or `"0"`) means no hold — behavior is identical to v1.8.
- Once the skeleton has rendered, the swap to the real template is **held until at least `min-duration` ms** have elapsed since it appeared. Data that arrives *after* the window swaps immediately, as always — the floor never adds latency to a genuinely slow load.
- **Last-wins is preserved.** Refreshes that land during the hold (store change, prop/param change) just update the pending model; exactly **one** swap fires at hold expiry, with the latest data, bracketed by `beforeUpdate`/`afterUpdate`.
- Destroying the view during the hold cancels it cleanly (no late render).
- The knob lives on the section because the section is per-component: different views hold for different times.

> Delay-*before*-show was deliberately rejected (D52): it would render an empty root during the delay — a blank flash worse than a brief skeleton. Puzzle only offers minimum-display-once-shown.

#### Handling load errors with a skeleton

There is **no error section** (settled won't-build, v1.20/D52): a declarative error slot couldn't even read the failure, since only `created()`-seeded state is visible during a skeleton render. Present load errors from the **real template** via the data model — `catch` in `data()` and return an error model, then branch in the template:

```html
<puzzle-view class="post-detail">
  {#if error}
    <p class="error">Couldn't load this post. <button @click={ retry }>Retry</button></p>
  {:else}
    <h1>{ post.title }</h1>
    <p>{ post.body }</p>
  {/if}
</puzzle-view>

<puzzle-skeleton min-duration="300">
  <div class="bg-skeleton h-8 w-1/2"></div>
</puzzle-skeleton>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class PostDetail extends PuzzleView {
  async data(params) {
    try {
      const post = await this.ctx.store.findOne('post', params.id);
      return { post, error: null };
    } catch (err) {
      // The commit resolves with an error model, so the skeleton swaps out
      // into the error state (rather than staying up forever). Contrast: an
      // UNCAUGHT rejection is logged and the skeleton stays up (DOC-SPEC §16).
      return { error: err };
    }
  }
}
</script>
```

Because `data()` **resolves** (with `{ error }`) instead of rejecting, its result commits normally and the skeleton swaps out into the error branch. This is the sanctioned pattern — see [[DOC-SPEC]] §16.

---

## Quick Reference

```html
<puzzle-view class="form-component">
  <button @click={ submitForm }>Save</button>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class FormComponent extends PuzzleView {
  created() {
    this.setData('saving', false)
  }

  // Class method - called internally
  async saveForm() {
    this.setData('saving', true)
    const store = this.ctx.store
    await store.createRecord('submission', this.getData().form)
    this.setData('saving', false)
  }

  // Event handlers - called by template (class field of arrow functions)
  events = {
    submitForm: (event) => {
      event.preventDefault()
      this.saveForm()  // Calls class method
    },
  };
}
</script>
```

## Related Documentation

- **[[DOC-USER-GUIDE]]** - Complete guide to building applications
- **[[DOC-DATASTORE]]** - Store, models, and data management
- **[[DOC-COMPILATION-FLOW]]** - Compiler and build details

Keep this document handy when designing components or extending the compiler. It represents the current contract between `.pzl` files, the compiler, and the runtime.
