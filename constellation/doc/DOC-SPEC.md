---
name: SPEC.md — the frozen v1 contract
status: verified
verified_at: '2026-07-17T23:27:11.833Z'
connections:
  - DOC-VIEW-LIFECYCLE
  - DOC-DECISIONS
---

The enforceable v1 contract: exports/naming, config surface, .pzl anatomy, real-JS scripts rule, event conventions, template grammar, models/store/router surfaces, and the deferred-features cut list. When docs conflict, SPEC.md wins.

# Puzzle v1 Specification

**Status: frozen contract for the v1 build.** Where any other document (README, USER_GUIDE, CLAUDE.md, older examples) conflicts with this file, this file wins. `examples/todos/` is the canonical reference application; `examples/blog/` is the second v1 reference app (blog domain; replaces the removed `example-app/`).

The organizing principle for v1: **the todos app compiling and running end-to-end is the only milestone that matters.** Every feature not needed for that is explicitly deferred (see [Deferred features](#deferred-features-post-v1)).

---

## 1. Naming & entry points

The runtime ships as the npm package `@magic-spells/puzzle` with four exports:

```js
import { PuzzleApp, PuzzleView, PuzzleModel, Puzzle } from '@magic-spells/puzzle';
```

| Export        | Purpose                                              |
| ------------- | ---------------------------------------------------- |
| `PuzzleApp`   | Application class. Instantiate once, call `.mount()`. |
| `PuzzleView`  | Base class for all `.pzl` components/views/layouts.  |
| `PuzzleModel` | Base class for models in `/models`.                  |
| `Puzzle`      | Schema field builders (`Puzzle.string()`, …).        |

Decisions this locks in:

- The app class is **`PuzzleApp`** (the runtime's internal `Puzzle` class is renamed; the `Puzzle` name now belongs to the schema-builder namespace).
- Apps start with **`app.mount()`**. `app.run()` is removed.
- Components are **class-based** (`extends PuzzleView`). The `Puzzle.createView` functional path and the duplicate view class generated inside `client-runtime/main.js` are removed.
- `PuzzleView` is a **plain JavaScript class** — not a custom element, no shadow DOM; the ViewManager owns all DOM mounting and patching (D15/D17, see [[DOC-VIEW-LIFECYCLE]]). `<puzzle-view>` survives as the template root element name only.

## 2. App configuration (v1 surface)

```js
// app.js
import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',       // CSS selector for the mount element
  routes,               // array of route definitions
  models,               // model registry from /models/index.js
  formatters: {         // optional: app-level template formatters
    pluralize: (count, singular, plural) =>
      count === 1 ? singular : plural || singular + 's',
  },
  apiURL: '/api',       // optional: base URL for future remote adapters
});

app.mount();
```

That is the **entire** v1 config surface: `target`, `routes`, `models`, `formatters`, `apiURL`. (v1.5 adds an optional `scrollBehavior` — see §14; v1.6 adds an optional `routerMode` — see §15; v1.11 adds an optional `routerInitialPath`, memory mode only — see §15; v1.19 adds an optional `routerBase` — see §23; v1.24 adds an optional `transitionMode` — see §26; v1.31 adds optional `beforeMount`/`mounted`/`beforeUnmount` app lifecycle hooks — see §34.) App-level `settings`, `computed`, global `events` (including keyboard-shortcut strings), and `methods` remain deferred — see the cut list.

## 3. `.pzl` file anatomy

```html
<puzzle-view class="my-component">
  <!-- markup + template directives -->
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class MyComponent extends PuzzleView { ... }
</scripts>

<styles>
/* optional global CSS */
</styles>
```

- `<puzzle-view>` is required; `<scripts>` and `<styles>` are optional. (v1.8 adds a fourth optional section, `<puzzle-skeleton>` — see §16.)
- Component imports (other `.pzl` files) live inside `<scripts>`, which is where esbuild resolves them.
- At most one `<styles>` block per file. Blocks are emitted as global CSS — v1 styling is Tailwind-first via utility classes; since v1.27 a bare `scoped` attribute opts a block into per-component scoping (§29, D59).
- **Two emission modes (D20).** Files under `app/views/**` and `app/layouts/**` compile to a real `<puzzle-view>` DOM element carrying the tag's attributes — the view boundary that navigation swaps and animations target (§12); the base stylesheet ships `puzzle-view { display: block }`. **Reusable components render inline**: the template's contents are emitted with no wrapper element, so `<CustomButton/>` renders as its `<button>` and nested components never stack wrapper elements (a list of items with buttons stays flat). For components, `<puzzle-view>` is only the template delimiter: it must carry **no attributes** (compile error — put them on your root element) and the template needs a **single root element** in v1 (fragments deferred).

## 4. `<scripts>` blocks are real JavaScript

This is the most consequential rule in the spec. The contents of `<scripts>` must parse as standard JavaScript — no custom dialect. The compiler extracts the block and hands it to esbuild **untouched**; the Go compiler never parses JS. Editors, ESLint, Prettier, and TypeScript work with zero special tooling. (TypeScript shipped in v1.22 via `<scripts lang="ts">`, transpile-only — the Go compiler still treats the body as an opaque string; see §25.)

Concretely, compared to older examples:

- `events` and `animations` are **class fields** (`events = { ... };`), not `name: { ... }` object-literal members.
- **No commas between class members.**
- Handlers inside `events` **must be arrow functions.** A class field initializer evaluates during construction with `this` bound to the instance, so arrows in the field permanently capture the component as `this` — detaching the handler (as event delegation does) cannot break it. Method shorthand (`addTodo(event) { ... }`) parses but binds `this` to the events object or `undefined`; the compiler rejects it with a build error.

```js
import { PuzzleView } from '@magic-spells/puzzle';

export default class TodoHome extends PuzzleView {
  created() {
    this.setData({ newTodoText: '', currentFilter: 'all' });
  }

  data(params, props) {
    const todos = this.ctx.store.findMany('todo'); // auto-subscribes
    const local = this.getData();
    return {
      todos,
      activeTodos: todos.filter(t => !t.completed),
      newTodoText: local.newTodoText,
      currentFilter: local.currentFilter,
    };
  }

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

  mounted() {}
  beforeUpdate() {}
  afterUpdate() {}
  destroyed() {}
}
```

### Class contract

| Member       | Kind                      | Notes |
| ------------ | ------------------------- | ----- |
| `data(params, props)` | method (may be `async`) | Returns the component model. Re-runs on mount, prop change, route-param change, and subscribed store changes. `setData()` does **not** re-trigger it. **Two-layer state (§35):** each successful `data()` result **replaces** the model layer wholesale — a key an earlier run returned but the new run omits disappears from `getData()` (unless `setData` wrote it). `setData` writes a separate persistent local layer: a `data()` commit wins over an *earlier* `setData` for the same key; a *later* `setData` wins until the next commit; local keys the model never returns survive every re-run. |
| `events`     | class field (object of arrows) | Template-facing handlers. Arrows only. |
| `created` / `mounted` / `beforeUpdate` / `afterUpdate` / `destroyed` | methods | Lifecycle hooks, in that order. |
| `animations` | class field | Declarative enter/leave animations (v1.1) — see §12. |
| anything else | methods/fields | Plain JS helpers, called internally. |

**Reserved names (§35).** `PuzzleView` owns these member names; a subclass member with the same name overrides framework behavior silently, so treat the list as off-limits for helpers:

- **Override points** (the contract — implement these): `data`, `render` (compiler-attached), `events`, `animations`, `transitionMode` (§33), `renderSkeleton`/`skeletonMinDuration` (§16, compiler-attached), and the hooks `created`, `mounted`, `beforeUpdate`, `afterUpdate`, `destroyed`, `viewWillShow`/`viewDidShow`/`viewWillHide`/`viewDidHide` (§12).
- **Read-only API** (call, never redefine): `getData`, `setData`, `memo` (§32), `ctx`, and the getters `element`, `loaded`, `isDestroyed`, `params`, `props`, `route` (§19).
- **Framework-called internals** (never touch): `mount`, `preload`, `refresh`, `applyParentUpdate`, `onStoreChange`, `flushUpdates`, `destroy`, `playIn`, `playOut`, `skipEnter`, `destroyAnimated`, `_localState`, and the compiler-reserved `__h` (§31) and `__ref` (§38). `refs` is the framework-owned element-ref map (§38) — read it, never assign it.

### Runtime/compiler implementation rules

- Generated `render()` is attached via **prototype assignment after the class definition** (`TodoHome.prototype.render = ...`). Generated code never rewrites the user's class body — sourcemaps and debugging stay honest.
- Class fields initialize **after** `super()` returns, so the `PuzzleView` base constructor must never read `this.events`. The runtime reads `this.events` **lazily at mount time**, when wiring template handlers.

## 5. Event handler convention

Two forms in templates, one rule each:

1. **Bare identifier** — `@click={ clearCompleted }` → the handler is invoked as `clearCompleted(event)`.
2. **Call expression** — `@click={ setFilter('all') }` or `@submit={ addTodo(event) }` → the compiler wraps the expression as `(event) => setFilter('all')`, evaluated **at event time** with `event` in scope. The handler receives exactly the arguments written in the template.

```html
<form @submit={ addTodo(event) }>
<input @input={ updateNewTodoText(event) } />
<input type="checkbox" @change={ toggleTodo(todo) } />
<button @click={ setFilter('all') }>All</button>
<button @click={ clearCompleted }>Clear</button>
```

```js
events = {
  addTodo: (event) => { event.preventDefault(); /* … */ },
  updateNewTodoText: (event) => { this.setData('newTodoText', event.target.value); },
  toggleTodo: (todo) => { todo.toggle(); },
  setFilter: (filter) => { this.setData('currentFilter', filter); },
  clearCompleted: () => { /* … */ },
};
```

The curried pattern from older examples (`toggleTodo: (todo) => () => { ... }`) is removed.

### Event modifiers (v1.7, D38)

A binding may carry `:modifier` suffixes — `@event:modifier[:modifier…]={ handler }` — that adjust dispatch declaratively. The handler value stays a plain function; the modifiers are encoded in the vnode key (`@keydown:enter:prevent`), so modifier-free bindings are unchanged.

| Modifier | Effect | Applies to |
| -------- | ------ | ---------- |
| `prevent` | `event.preventDefault()` | any event |
| `stop` | `event.stopPropagation()` | any event |
| `once` | handler fires **once ever** for this binding (the spent-marker survives per-patch handler swaps; it clears only when the binding is actually removed, so a later re-add starts fresh) | any event |
| `enter` `escape` `tab` `space` `up` `down` `left` `right` `backspace` `delete` | key filter — handler runs only when `event.key` matches (`Enter`/`Escape`/`Tab`/`' '`/`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Backspace`/`Delete`; `backspace`/`delete` added in v1.13, D45) | `keydown`/`keyup`/`keypress` only |

Modifiers stack, and **execution order is canonical regardless of written order**: key-gate → once-spend → `preventDefault` → `stopPropagation` → handler. The key gate runs first, so a non-matching key bails before `preventDefault` (native behavior preserved) and without spending `once`.

**Compile errors (not warnings):** unknown modifier, a key filter on a non-keyboard event, a duplicate modifier, more than one key filter, or any modifier on a **component callback prop** (component-tag `@name={...}`, D16).

```html
<input @keydown:enter={ addTodo(event) } @keydown:escape:prevent={ cancelEdit } />
<a @click:prevent:stop={ navigate('/home') }>Home</a>
<button @click:once={ claimReward }>Claim</button>
```

## 6. Template grammar (v1)

Supported:

- **Interpolation:** `{ expression }` with plain JS expressions.
- **Expression boundary (contract):** template expressions are **lexed, not parsed** — the compiler tokenizes them (string/template/regex/comment-aware) and prefixes data identifiers, but has no expression grammar (§4: the Go compiler never parses JS). Consequences, by design and not bugs: (a) the only names in scope are `data()` fields, loop variables/counters, `event` (in handlers), and JS globals — an identifier imported or declared in `<scripts>` is **not** reachable (it compiles to a data read of the same name and evaluates `undefined`; since the pre-0.1.0 hardening pass the compiler emits a positioned **warning** when a template expression reads a name that `<scripts>` imports); (b) binding-introducing forms are unsupported in expressions — arrow functions, object literals at expression head (positioned compile error), and destructuring — because a lexer cannot see binding positions. The supported idiom is unchanged: compute in `data()`, render the result.
- **Formatters:** `{ value | formatter(args) }`, chainable (`{ text | trim | capitalize }`). Display-only; filtering/sorting belongs in `data()`. **Unknown-formatter guard (v1.12, D43):** a formatter name not in the runtime registry does **not** crash the render — the compiled call is guarded (`(__f["name"] || __f.__missing("name"))(…)` — bracket access, since registry keys are arbitrary strings), the value passes through unchanged, and one `console.error` per unknown name identifies it (with a did-you-mean suggestion when a close match exists). A compile-time check is impossible by design: custom formatters are registered at runtime (§2), and the compiler never parses JS (§4).
- **Conditionals:** `{#if expr} … {:else} … {/if}`.
- **Conditional chaining (v1.9, D40):** `{#if a} … {:else if b} … {:else} … {/if}` — zero or more `{:else if expr}` clauses between the `{#if}` body and the optional trailing `{:else}`, which must be the **last** clause. `expr` is any JS expression, exactly like `{#if}`. Desugars at parse time to nested `{#if}` nodes (additive; codegen unchanged). Spelled `else if` (JS), not `elsif` — `{:elsif}`/`{:elseif}` get a did-you-mean compile error. Compile errors: an empty condition, `{:else if}` after `{:else}`, `{:else if}` outside `{#if}`, inside `{#unless}` or `{#case}` (see D36/D37), and inside attribute-value inline-ifs (the attribute mini-grammar stays flat `{#if}…{:else}` only).
- **Inverted conditional (v1.7, D36):** `{#unless expr} … {/unless}` renders the body when `expr` is **falsy**; an optional `{:else}` renders when `expr` is truthy. `expr` is any JS boolean expression, exactly like `{#if}`. Desugars at parse time to a negated `{#if}` (additive; codegen unchanged). `{:else if}` inside `{#unless}` is a positioned compile error suggesting an `{#if}` restructuring.
- **Multi-branch (v1.7, D37):** `{#case expr}` + one or more `{:when v1, v2, …}` clauses (top-level commas are **OR**) + optional trailing `{:else}` + `{/case}`. Matching is strict `===`, **first match wins, no fallthrough**; the case expression is evaluated exactly once. Compile errors: missing case expression, zero `{:when}` clauses, non-whitespace content before the first `{:when}`, a valueless `{:when}`, a `{:when}` after `{:else}`, `{:else if}` inside a case, a `{:when}` outside any case, and unclosed/mismatched closers. Named `{#case}` (not `{#switch}`) after Puzzle's Liquid heritage — no `break`/fallthrough semantics.
- **Loops:** `{#for item in items} … {/for}` and range form `{#for 1...n} … {/for}`. A trailing `, name` on either header binds the **loop counter** — `{#for item in items, i}` (0-based index) / `{#for 1...n, x}` (the current number) — in scope throughout the block like the item variable (v1.2, D29; additive, keying unchanged). Rows are keyed automatically — pk-aware since v1.26, with an explicit `key={ … }` override on the body root; see §28 (D58).
- **Attribute values:** interpolation and inline `{#if}` blocks inside attribute values, e.g. `class="base {#if done}line-through{/if}"`.
- **Bindings:** `value={ var }` (two-way on inputs), `checked={ expr }`, `disabled={ expr }`, and other dynamic attributes.
- **Events:** `@event={ … }` per section 5.
- **Components:** capitalized tags with props — `<UserProfile userId={selectedUserId} />` — imported in `<scripts>`.
- **Component children (default slot):** children written at a component's call site render at the child's `<children/>` marker (D16; spelled `<slot />` until v1.41 — D74, §24) — `<Card><p>body</p></Card>`. Guidance: **props for data, slots for markup** — pass `label="Save"` when it's a string, pass children when the caller supplies actual content.
- **Callback props:** `@name={ handler }` on a **component tag** passes the wrapped handler to the child as the prop `name`; the child receives it via `data(params, props)` and calls it like any function. DOM listeners belong to the child's own template — the event lands on the child's element first, the child's handler gates/shapes it, then invokes the parent's callback, which executes in the parent (D16).
- **Layout slot:** `<Slot/>` inside layout components renders the routed view.
- **DOM islands (v1.13, D44):** a bare static `island` attribute on a plain element makes its children browser-owned after mount — the template children render once as *seed content* and are never reconciled again, while the element's own attributes and listeners keep patching normally. See §17.
- **Element refs (v1.39, D72):** a static `ref="name"` on a plain element binds the live DOM node to `this.refs.name` — populated before `mounted()`, re-pointed on replacement, nulled on removal; the attribute never reaches the DOM. Static-string only (`ref={ expr }` is a positioned compile error — the expression boundary makes a braces form unimplementable); see §38 for the full contract and error set.
- **Comments (v1.37, D70):** `{## any text }` (inline, self-contained) and `{#comment} … {/comment}` (block; body discarded **raw** — interpolations, block tags, and malformed template code inside are ignored, so it can comment out broken markup; nested `{#comment}` blocks count). Both are erased at the lexer — no token, no vnode, nothing in the bundle — and are legal at any text position, including `<puzzle-skeleton>` bodies. Inline comments track `{`/`}` nesting depth with `\{`/`\}` escapes and are deliberately NOT string-aware (`{## don't }` is fine); a lone `}` needs `\}`. The block closer tolerates whitespace (`{/ comment }`); opener content after the keyword is ignored. HTML comments `<!-- -->` remain compile-time-stripped as always. Compile errors (positioned): unclosed `{##`, unterminated `{#comment}`, either spelling inside an attribute value, a stray `{/comment}`. Additive; comment-free templates compile byte-identically.

Deferred: `$emit`/event bus. (Named slots shipped in v1.21 — D53, §24; `<puzzle-skeleton>` auto-swapping shipped in v1.8 — D39, §16.)

## 7. Models & schema builders

Schemas are declared with the `Puzzle` field builders — the **only** documented way to define fields (raw descriptor objects are an internal format):

```js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Todo extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date()),
  };

  toggle() {
    return this.update({ completed: !this.completed, updatedAt: new Date() });
  }
}
```

**Types:** `Puzzle.string()`, `Puzzle.number()`, `Puzzle.boolean()`, `Puzzle.date()`, `Puzzle.array()`, `Puzzle.object()`.

**Modifiers (chainable):**

| Modifier | Meaning |
| -------- | ------- |
| `.primary()` | Primary key; implies required. |
| `.required(message?)` | Field must be present. |
| `.default(value \| () => value)` | Applied on `createRecord` when absent. |
| `.min(n, message?)` / `.max(n, message?)` | Length for strings/arrays, value for numbers/dates. |
| `.oneOf([...], message?)` | Enum constraint. |
| `.validate(fn, message?)` | Custom rule escape hatch. |

**Computed properties** are plain JavaScript getters on the model class (`get fullName() { return ... }`) — no `computedProperties` map, no registration. They work anywhere a record is read, including templates.

**v1 enforcement:** `.default()` and `.primary()` are honored by the store. Validation rules (`required`, `min`, `max`, `oneOf`, `validate`) were stored-but-inert in v1; **since v1.16 they enforce at the local write boundary** (`createRecord`/`update` throw `PuzzleValidationError`; `Model.validate(data)`/`record.validate()` return `{ valid, errors }`) — see §20 (D48). Relationships (`Puzzle.hasMany(...)` / `Puzzle.belongsTo(...)`) shipped in v1.17 as lazy store-backed getters — see §21 (D49) — replacing the old `static relationships` block.

**Server access (D21):** the model declares its server location — `static adapter = { endpoint: '/api/todos' }` — and v1 consumes it on the **read path** via `store.loadAll(type)` / `store.loadOne(type, id)` (§8). Write sync and custom adapter methods shipped in v1.18 — `record.save()`/`record.delete()`/`store.request()`, see §22 (D50); query fault-in remains deferred. Local persistence is in-memory with optional localStorage.

## 8. Store (v1 surface)

```js
const store = this.ctx.store;

store.createRecord('todo', { text: 'Ship v1' }); // applies schema defaults
store.findOne('todo', id);
store.findMany('todo');
store.findMany('todo', { filter: (t) => !t.completed });

// server read path (D21): reads the model's static adapter.endpoint,
// prefixes the app's apiURL, upserts records (subscribers notified)
await store.loadAll('todo');
await store.loadOne('todo', id);

record.update({ completed: true }); // triggers subscribed data() re-runs
record.destroy();
```

Any query made inside `data()` auto-subscribes the component; changes to matching records re-run `data()`.

## 9. Router (v1 surface)

```js
// routes.js
export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Home' } },
  { path: '/user/:id', name: 'user', view: UserView, layout: DefaultLayout },
];
```

- HTML5 history API by default; v1.6 adds opt-in hash mode via `routerMode: 'hash'` — see §15.
- `:param` segments arrive as `params` in the view's `data(params, props)`.
- `layout` wraps the view; the layout template renders it at `<Slot/>`.
- `meta.title` sets `document.title` on navigation.
- Navigation: `this.ctx.router.push('/user/123')`.
- **Programmatic history (v1.11, D42):** `router.go(n)` / `router.back()` / `router.forward()` in **all** modes — history/hash delegate to `history.go(n)` (the popstate path handles the rest); memory mode moves its internal stack index. Out-of-range `n` is a silent no-op (browser semantics).
- **Commit order:** for `push()`, the URL updates only after the new view's `data()` resolves — URL, rendered view, and `document.title` change atomically; a failed or superseded navigation changes nothing. Rapid navigations cancel (last wins).
- **404:** an optional catch-all route `path: '*'` (always matched last) receives unmatched URLs; without one the router warns and stays on the current view.
- **Layout reuse:** consecutive routes sharing the same layout class reuse the layout instance — its `data(params)` re-runs and only the `<Slot/>` content swaps; a different layout class remounts.
- **Transitions (v1.1):** navigation plays the old view's `out` animation, then swaps, then the new view's `in` animation, sequentially — see §12.

**Nested routes (v1.3, D30):**

```js
// routes.js
export default [
  {
    path: '/settings', name: 'settings', view: SettingsShell, layout: DefaultLayout,
    children: [
      { path: '',        name: 'settings-index',   view: SettingsHome },
      { path: 'profile', name: 'settings-profile', view: ProfileView },
      { path: 'billing', name: 'settings-billing', view: BillingView },
    ],
  },
];
```

- A route object may carry `children: [...]` of route objects. Child `path` is **relative** to the parent (`/settings` + `profile` → `/settings/profile`); the parent's view renders its matched child at its own `<Slot/>` (the same injection point layouts use).
- `layout` is a **top-level-route field only** — layouts are root shells; children inherit the chain's layout. `layout` on a child is a **constructor throw** (as are: a child `path` with a leading `/`; `path: '*'` inside `children`; a duplicate `:param` name within one chain).
- An **index child** `path: ''` matches the parent's bare URL. A parent that has `children` but **no** index child does **not** match its own bare URL — it falls through to the catch-all.
- **Params merge down the chain:** the full URL is matched once; **every level's `data(params)` receives the full merged params object**. `meta.title` for the tab resolves nearest-defined, walking leaf → root.
- **Chain reuse:** navigation keeps the shared route-chain prefix (ancestor instances are reused, their `data()` re-run with merged params and **awaited before the URL commits**, per D19); only divergent levels are torn down and rebuilt. The D28 one-animator rule generalizes — the **topmost swapped view** animates and everything below it rides along.
- **Route snapshot (v1.15, D47):** inside any routed `data()` run, `this.route` describes the navigation being gated — the only route source that is correct pre-commit (`router.current` and `location` still hold the old route there). See §19.

Flat routes (no `children`) are unchanged.

Full state machine and rationale: [[DOC-VIEW-LIFECYCLE]] (D17–D19, D30).

## 10. Component context

`this.ctx` exposes exactly three services: `store`, `router`, `formatters`. The extended surface in older docs (`this.$app`, `this.$events`, `ctx.utils`, global event bus) is deferred.

## 11. Project layout & build

- Source directory: **`app/`** (`app/app.js` is the entry). Output: **`dist/`**.
- Static files: **`app/public/`** is copied verbatim into `dist/` at build. **`app/assets/`** (v1.14, D46) is the inverse — compile-time-only inputs for `{#svg}` inlining (§18), never copied to `dist/`.
- `.pzl` compilation is implemented as an **esbuild plugin** (esbuild is Go-native): the Go side parses templates and generates render functions; esbuild owns module resolution, bundling, sourcemaps, and minification.
- CLI v1: `puzzle build` (production by default) and `puzzle dev` (watch + static server with history-API fallback + live reload via SSE full-page reload; no HMR). (v1.4 adds the scaffolding/tooling commands — see §13.)
- Styling: Tailwind-first. `puzzle.config.js` with `styles: { use: ['tailwindcss'] }`. A Sass pipeline is **not supported and will not be** (D35) — native CSS nesting plus Tailwind cover the ground a preprocessor used to.

## 12. Animations (v1.1)

Declarative enter/leave animations on views, layouts, and reusable components, driven by the Web Animations API. Shipped in v1.1 (D28); the `animations` class field is no longer inert.

**Field shape.** An optional `animations` class field with optional `in` and `out` keys:

```js
animations = {
  in:  { from, to, duration, easing?, delay? },
  out: { from, to, duration, easing?, delay? },
};
```

Each spec compiles to `el.animate([from, to], { duration, easing, delay, fill: 'both' })`. `from`/`to` are WAAPI keyframe objects; `duration`/`delay` are milliseconds; `easing` is any CSS easing string. Either key may be omitted (that phase then runs instantly). A malformed spec **warns once and is skipped** — it never breaks rendering. *(Amended in v1.40: an `in` spec may also carry `trigger: 'visible'` + `triggerOffset` to defer the enter until the element scrolls into view — §39, D73.)*

**Animation target.** The instance's own root element — for views and layouts the `<puzzle-view>` element; for reusable components the single root element the template requires (D20). There is **no wrapper element**; the single-root rule makes the root the animation handle.

**Completion.** Detected via the WAAPI `Animation.finished` promise. Interrupting navigation or unmount **cancels** the running animation and proceeds immediately.

**Lifecycle hooks.** Four no-op base methods on `PuzzleView`, firing around each phase:

- Show path: `viewWillShow()` → `in` animation → `viewDidShow()`.
- Hide path: `viewWillHide()` → `out` animation → `viewDidHide()`.

Hooks are lifecycle, not animation callbacks — **they fire in order even when no `animations` field is declared** (zero-duration semantics). They compose with the existing hooks: `mounted()` precedes `viewWillShow()`; `viewDidHide()` precedes `destroyed()`.

**View transitions are sequential in v1.1.** After the new view's `data()` resolves (the D19 gate), the old view plays `out` and is destroyed; then — in one synchronous block, atomically with the new view mounting (§30, D61) — the URL and title commit and the new view plays `in`. A navigation superseded or failed while the old view is animating out commits nothing. The enter animation is **non-blocking** (fire-and-forget) — navigation is not held open waiting for it. Cross-fade / overlapping transitions are deferred (they need a positioning strategy). *(Amended: overlap shipped in v1.24, §26; the location-commit placement moved in v1.28, §30 — v1.1–v1.27 committed URL/title before the out animation.)*

**One animator per transition.** A routed view swapped inside a **reused** layout animates alone (the layout does not animate). On a **layout swap**, the layout animates as the unit and its view rides along — no double animation.

**Enter animations release on finish.** After an `in` animation's `finished` resolves, its filled styles are cleared so the element sits in its natural styled state. Therefore the `to` keyframe **must equal the element's natural resting style** — otherwise a visible snap occurs at release.

**Reduced motion.** When `matchMedia('(prefers-reduced-motion: reduce)')` matches, all durations are zeroed; hooks still fire in order.

**Height animations need explicit pixel values.** WAAPI cannot animate to `height: auto`. Collapse/expand effects must animate between explicit `px` values (the shipped pattern wraps the row's content in a fixed-height inner element — see USER_GUIDE).

## 13. CLI tooling (v1.4)

The scaffolding and diagnostics commands SPEC §11 left for later. Shipped in v1.4 (D32); the CLI is no longer just `dev` + `build`. Additive — no change to `dev`/`build`, the compiler, or the runtime.

- **`puzzle init <app-name> [--template default|todos] [--dir <parent>]`** — scaffolds a complete Tailwind-first app (`app/` source with `app/app.js` entry, `puzzle.config.js`, `index.html`) from an embedded template tree. `default` is a minimal starter; `todos` is the todos example app. **Non-interactive by design** — flags and defaults only, so it stays scriptable (CI, `npx`); the one exception (D32 amendment) is a bare `puzzle init` on a TTY, which prompts for the missing app name (zero args on a non-TTY still errors, so pipes/CI never hang). *(v1.44/D77 widens the TTY exception: template and TypeScript prompts when those flags are absent — see §42; non-TTY behavior is unchanged.)* App names are validated npm-safe; a non-empty target directory is refused.
- **`puzzle generate <component|view|layout|model> <Name> [--path <dir>] [--force]`** (alias `g`) — writes a stub into `app/components|views|layouts|models`, finding the project root by walking up for `package.json`/`puzzle.config.js`. `.pzl` type names are PascalCase, model names lowercase.
- **`puzzle add tailwind`** — writes the canonical `puzzle.config.js` + `app/styles/styles.css` when absent.
- **`puzzle add piece <name…> [--registry <path|url>] [--overwrite] [--dir]`** (D32 amendment, 2026-07-17) — copies copy-in UI pieces from the puzzle-pieces registry into the app: resolves `registry.json`, pulls `registryDependencies` transitively (piece names and `lib/*.js` utils), copies files VERBATIM to each manifest's `targetDir` (default `app/components/ui/`; libs to `app/lib/`), refuses existing files unless `--overwrite` (all-or-nothing pre-flight), records sha256 content hashes in `pieces.lock` (the version story — enables a future `diff`/`update`), auto-copies the registry theme to `app/styles/pieces.css` when the app lacks it (locked like a piece), and PRINTS the accumulated `npm install` line + the one-line `@import './pieces.css';` advisory rather than running/rewriting anything (styles.css is user-owned — D3). Registry source: `--registry` flag → `PUZZLE_PIECES_REGISTRY` env → the published GitHub raw URL.
- **`puzzle add skills [--overwrite]`** (alias `skill`; D78, 2026-07-22) — installs the CLI's embedded Puzzle agent skill (`skills/puzzle/` in-repo, `go:embed` at build time so the payload always matches the CLI version) into every detected agent config dir: a target is offered iff `~/.claude` / `~/.codex` / `~/.cursor` exists, destination `<root>/skills/puzzle/` (created as needed). On a TTY: huh checkbox multi-select, all targets pre-selected; non-TTY installs to all detected targets silently (never prompts, never hangs). Existing installations refuse without `--overwrite` (all-or-nothing pre-flight). No detected targets is a friendly no-op, exit 0.
- **`puzzle doctor [dir]`** — ✓/✘/! checks (node on PATH, `app/app.js`, `index.html`, config loads, Tailwind CLI resolves, runtime package present); exits 1 on any failure. **`puzzle info [dir]`** — prints puzzle version, platform, node version, project root, source/output dirs, and the declared styles pipeline. `puzzle --version` reports the CLI version.

**No-JS-rewriting rule (D3).** `add` and `generate` never parse or rewrite the user's JavaScript: `generate model` does not edit `app/models/index.js`, and `add tailwind` never rewrites an existing `puzzle.config.js`. When wiring is needed they **print the exact snippet** (registration line / config block + install command) for the author to paste. Generated `.pzl` stubs are compile-checked against the compiler in tests, so they cannot drift from the grammar.

## 14. Router scroll behavior (v1.5)

The router owns **window scroll** across navigations. Shipped in v1.5 (D33); a router-only amendment — no compiler or runtime-kernel change, and it adds the first field to the frozen §2 config surface (`scrollBehavior`).

**Default (no config).**

- **push / link navigation → scroll to top** (`window.scrollTo(0, 0)`).
- **back/forward (popstate) → restore** the position that history entry was at when the user left it, **falling back to top** when none is saved.
- The **initial navigation never touches scroll** (the browser owns first paint).
- A **failed or superseded navigation never touches scroll** — the landing is resolved at commit and applied only once the view is on screen, so a nav that never commits leaves the window where it was.

Saved positions are held in an in-memory map and — since v1.10 (D41) — mirrored to `sessionStorage`, so back/forward restore survives a full page reload (see below).

**Timing.** The landing is applied **synchronously inside the router's commit** — after the incoming view is in the DOM, before the next paint, and **after the old view's `out` animation** (§12). Scroll therefore never jumps mid-transition or flashes the old offset on the wrong content.

**Mechanics.**

- `history.scrollRestoration = 'manual'` is set between `start()` and `stop()` (the previous value is restored on `stop()`), so the browser's automatic restoration — which fires on popstate **before** the old view has swapped out — never scrolls the wrong content.
- Positions are keyed by a per-entry `__puzzleScrollKey` stamped into `history.state`: `pushState` carries a fresh key; entries the router did not create (a foreign entry, or the initial one) get a key lazily via `replaceState` (preserving any other state).
- On **popstate** the outgoing position is saved under the **in-memory current key** *before* the target entry's key is adopted — the browser has already moved `history.state` to the target entry, so the key the window still shows must be read from the router's own bookkeeping, not from `history.state`.

**Config (`scrollBehavior`).** An optional field on the PuzzleApp config (v1.5 amendment to the frozen §2 surface):

- **omitted** → the default above.
- **`false`** → the router never touches scroll. For apps whose shell scrolls an inner panel rather than the window (e.g. the music example's `overflow-hidden` layout), where a window scroll-to-top is meaningless.
- **`(to, from, savedPosition) => {x, y} | null`** → custom. `to` and `from` are `{ path, params, route, chain }` snapshots (`from` is `null` on the initial navigation); `savedPosition` is the entry's saved `{x, y}` and is **non-null only on a pop** (`null` on push). A **falsy return** (`null`/`false`/`undefined`) leaves scroll alone; a **throw** is logged and treated as falsy — the navigation itself is unaffected.

**Anchor targets (v1.10, D41).** A `#anchor` suffix on a navigation target refines the **default push landing**: `push('/docs#faq')` (or a link whose href carries the fragment — the history-mode interceptor now preserves `url.hash` instead of dropping it) lands the window at `document.getElementById('faq')` (id `decodeURIComponent`-ed), **falling back to top** when no such element is in the committed DOM — including a v1.8 skeleton view whose anchor target hasn't rendered yet (the scroll is never re-applied when the real template lands). On a **pop**, a saved position still wins over the anchor. A custom `scrollBehavior` function still wins over everything; the anchor rides verbatim in `to.path`. Resolution happens inside the commit, after mount (an element position can't be computed off-DOM); timing is otherwise unchanged. In **hash mode** the anchor rides *inside* the fragment — `push('/docs#faq')` writes `#/docs#faq`, and `<a href="#/docs#faq">` is intercepted by the existing `#/` rule (browsers tolerate the double hash; bare `#faq` hrefs remain native, and remain the §15 hazard).

**Position persistence (v1.10, D41).** Every position save mirrors the in-memory map to a single `sessionStorage` key (`__puzzleScroll`); `start()` hydrates the map from it. Because per-entry `__puzzleScrollKey`s live in `history.state` — which survives reloads — reload + back/forward restores the pre-reload position. The map is capped at **50 entries, oldest evicted**. All storage access is fail-soft (`try/catch`): quota errors or disabled storage degrade to the v1.5 in-memory behavior exactly. `scrollBehavior: false` touches no storage.

**Not in v1.10** (Planned — not in v1.10):

- An `{ el }`-style return shape for custom `scrollBehavior` functions (the default anchor behavior covers the use case; the return contract stays `{x, y} | null`).
- Scroll retention inside non-window scroll containers; smooth-scroll options.

## 15. Hash routing (v1.6)

The router can carry the route in `location.hash` (`https://host/app/index.html#/user/123?tab=posts`) instead of the pathname. Shipped in v1.6 (D34); a router-only amendment — no compiler or runtime-kernel change, and it adds the **second** field to the frozen §2 config surface (`routerMode`, after v1.5's `scrollBehavior`). Hash mode is the deployment story for **static hosts** — GitHub Pages, an S3 bucket, `file://` — where you cannot configure the history-API fallback that pathname routing needs (serve `index.html` for every route). The pathname never changes, so no server rewrite is required.

**Config (`routerMode`).** An optional field on the PuzzleApp config, an enum:

- **omitted / `'history'`** → pathname routing (the v1.5 behavior, exactly).
- **`'hash'`** → the route lives in `location.hash`; the pathname is left alone.
- **`'memory'`** (v1.11, D42) → the route lives entirely in router state; `location` and `history` are never read or written — see below.

Any other value is a **constructor throw** (fail-fast, like the route-shape throws). `routerMode` passes straight through to `new Router(routes, { mode })`.

**Memory mode (v1.11, D42).** For tests (no jsdom history gymnastics) and embedded/iframe apps that must not touch the host page's URL. An in-memory entry stack replaces `history`: `push()` truncates forward entries and appends (browser semantics); `router.go(n)`/`back()`/`forward()` (§9) move the stack index and run the pipeline as a pop. The full D19/D28/D30 pipeline — atomic commit, cancellation, sequential transitions, nested chains — runs unchanged. Differences, all deliberate:

- **No document-level side effects:** no popstate listener, and `meta.title` does **not** set `document.title` (an embedded widget must not rename the host page's tab).
- **Scroll management is a no-op:** `scrollBehavior` is accepted but inert — there are no history entries to key restoration off, and an embed shares the window with a host page the router has no claim on.
- **The click interceptor stays active** (app code stays path-shaped and mode-agnostic): same-origin pathname links route in memory. *Embed caveat:* interception is document-global, so same-origin path links in the host page are intercepted too — the same trade hash mode makes; scope your embed's links accordingly.
- **`routerInitialPath`** (PuzzleApp config; Router option `initialPath`) names the first route, default `'/'` — there is no URL to read. Setting it in history/hash mode is a **constructor throw** (the URL is the initial path there; a silently ignored field would hide a config bug). Third amendment to the frozen §2 surface.

**The app-facing API stays path-shaped and mode-agnostic.** Route definitions, `push('/user/123')`, `current.path`, params, nested routes, `meta.title` — all identical in both modes. **No `#` ever appears in app code**; the hash is purely a URL-encoding detail the router owns. The mode choice is a one-line config change with no other edits.

**What the mode changes — three seams only:**

- **Reading the current URL.** History mode reads `location.pathname + location.search`; hash mode parses `location.hash` — `''`/`'#'` → `/`; `#/...` → that path (an in-fragment `?query` rides along); any other fragment (`#section2`) is **not a route fragment**.
- **Writing the URL on push.** Hash mode calls `pushState` with `'#' + path` (the D33 `__puzzleScrollKey` still rides in `history.state`); the pathname is never touched.
- **The link interceptor.** In hash mode `<a href="#/about">` is intercepted and routed via `push` (full D19 semantics); a bare `<a href="#faq">` stays a native in-page anchor; a same-origin link with a **different** pathname falls through to the browser (a real navigation away from the app shell); a full URL on the **same** pathname carrying a `#/...` fragment is intercepted.

**Listening is popstate-only, in both modes** (never `hashchange`): fragment navigations fire `popstate` in supported browsers — the same bet Vue Router 4 makes (its hash history is the HTML5 history with a `#` base). A `popstate` whose hash is a **non-route** fragment routes `/` on initial load but is **ignored entirely** on the pop — the rendered view is left alone, so an in-page anchor traversal never tears down the app.

**Everything downstream is untouched and works identically in hash mode:** the D19/D61 atomic commit (the URL moves only after `data()` resolves — and, since v1.28, atomically with the incoming mount; a failed or superseded navigation moves nothing, §30), D28 transitions, D30 nested chains, and D33 scroll behavior (keys ride in `history.state` on the `pushState`).

**In-page-anchor limitation (inherent to hash routing).** In hash mode, clicking a bare in-page anchor (`#faq`) replaces the whole fragment, clobbering the current route from the URL. The rendered view survives (the pop is ignored) and back returns to the route, but the URL no longer names it. This is inherent to hash routing everywhere, not a Puzzle quirk — hash-mode apps should avoid bare-anchor links.

**Not in v1.11** (Planned — not in v1.11; `'memory'` mode itself shipped in v1.11 — above):

- Base-path support (hash-fragment base for sub-path hosting, and the history-mode equivalent — history mode assumes root deployment today). Deciding it properly means deciding it for both modes at once.
- Mount-scoped link interception for embeds (interception is document-global in all modes).

## 16. Skeleton loading (v1.8)

The deferred "`<puzzle-skeleton>` auto-swap" ships in v1.8 (D39): a declarative loading template shown while a component's **first `data()`** is pending, then swapped for the real template. Compiler + runtime + a router amendment; presence-driven — no config surface, no new API to call.

**The section.** An optional fourth `.pzl` section, sibling of `<puzzle-view>`:

```html
<puzzle-view class="post-detail">
  <h1>{ post.title }</h1>
  <p>{ post.body }</p>
</puzzle-view>

<puzzle-skeleton>
  <div class="animate-pulse">
    {#for 1...3}
      <div class="bg-skeleton h-4"></div>
    {/for}
  </div>
</puzzle-skeleton>
```

- At most **one** per file; the `<puzzle-skeleton>` tag itself takes **no attributes** (compile error) — in view mode the skeleton renders under the same `<puzzle-view>` root (and attributes) as the real template, so the loaded swap patches children only.
- The body uses the **full template grammar** (§6). The range `{#for}` is the idiomatic way to repeat placeholder rows. **Only `created()`-seeded state is readable** during a skeleton render — `data()` hasn't resolved, so expressions against the component model will be `undefined`.
- **Component mode (D20):** like the template, the skeleton needs a **single root element**, and it must be a **plain element** (a component root is a compile error). Keep its tag equal to the template root's so the swap patches in place.
- Compiled to a second prototype-assigned method, `Name.prototype.renderSkeleton` — same idiom as `render()` (§4).

**Runtime semantics.** A component is **loaded** once its first `data()` result commits (`view.loaded` getter). While unloaded, a declared skeleton is what renders:

- **Async first `data()`** → the skeleton renders immediately in the reserved position, `mounted()` fires against the skeleton DOM, and the mount no longer waits on data — a child component's enter animation (§12) plays on the skeleton, and the real render patches over it (bracketed by `beforeUpdate`/`afterUpdate`) when the data commits.
- **Synchronous / already-resolved `data()`** → the skeleton never appears.
- **`loaded` never resets.** Later refreshes (store change, prop/param change) keep the CURRENT content on screen until the new data commits (§4 last-wins) — a skeleton is a first-load affordance, not a spinner.
- A `data()` rejection while the skeleton is up is **logged and the skeleton stays** — surfacing load errors is the view's job (catch in `data()` and return an error model).

**Routing (the one D19 amendment).** A **fresh** routed view (or layout) that declares a skeleton **does not gate the navigation commit on its `data()`**: the navigation proceeds without awaiting the load, the view mounts showing its skeleton, and the real content patches in when `data()` commits. Reused ancestors **always** gate (visible content never regresses mid-navigation), and skeleton-less views keep the await-then-commit semantics byte-for-byte. *(Since v1.28, §30/D61, the location commit itself rides the swap: in sequential mode the URL/title still move only after the outgoing view's `out` animation — the skeleton exemption bypasses the DATA gate, not the transition.)* The traded guarantee, accepted knowingly: for a skeleton view, a failed load can leave the URL pointing at a view still showing its skeleton (error logged) — the URL commits to the page's *declared loading state* rather than its data.

**Anti-flash hold (v1.20, D52).** The section tag accepts exactly one optional attribute — `min-duration`, a static unsigned integer in milliseconds: `<puzzle-skeleton min-duration="300">`. Once the skeleton has rendered, the loaded swap is held until at least that long after it appeared (data arriving later swaps immediately, as always). Last-wins is preserved — refreshes during the hold update the pending model and one swap lands at expiry with the latest data; destroy cancels the hold. Absent = 0 = v1.8 behavior byte-identical. Any other attribute, a dynamic/interpolated value, or a malformed number is a compile error. Compiled as a prototype assignment beside `renderSkeleton` (`skeletonMinDuration`).

**Settled in v1.20 (D52):**

- The timeout/error slot (`<puzzle-skeleton error>…`) is **won't-build** — error presentation stays in the real template via the data model (catch in `data()`, return an error model); a declarative error section couldn't even read the error (only `created()`-seeded state is visible there).
- Delay-before-show is **rejected** — it would render an empty root during the delay, a blank state the D19 immediate-commit exists to prevent.
- Skeletons on refresh/params-only navigations stay deliberately excluded (see `loaded` above).

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
- **Identity:** keyed islands move with their DOM subtree intact. A **tag or key change replaces the node and re-seeds from the template** — changing the key is the sanctioned "reset this island" lever.
- **The attribute never reaches the DOM** — `island` is a framework directive, stripped like `key`. Style hooks belong to the author's own classes.

**Compile errors (not warnings):** a dynamic value (`island={ expr }` — island-ness cannot toggle mid-life); `island` on a component tag (it is not a prop); a component tag or any composition marker (`<children/>`/`<slot name>`/`<Slot/>`) anywhere inside an island subtree (a live instance inside browser-owned DOM can be destroyed out from under the framework); `island` on the `<puzzle-view>` root (the view root is the navigation/animation boundary, D20/D28).

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

**Inlining semantics — the file is inert.** The compiler strips an optional XML prolog/DOCTYPE, requires a single `<svg …>` root (nested `<svg>` inside is fine — depth-counted), tokenizes **only the root open tag** to lift its attributes onto a vnode, and embeds everything inside as a **verbatim string**. File contents are never template-parsed: `{ expr }`, `{#blocks}`, components, and event handlers inside the file do nothing (literal `{` is fine — it's just text). At runtime the root `<svg>` is a real vnode (the differ places/removes it; created via the SVG-namespace path) whose string children are seeded once via `innerHTML` and then **island-owned (D44)**: never reconciled, zero diff cost per patch regardless of file size. The escape hatch is explicit: want a reactive or animated SVG? Paste the markup into the template directly — arbitrary SVG in templates has always compiled (no element whitelist, automatic `createElementNS` namespace propagation).

**Styling contract.** No per-use attributes on the tag — `{#svg 'path' class="…"}` was rejected as an incoherent mix of Liquid-tag and HTML-attribute syntax (Shopify's own `{% render %}` takes none). Style the icon the Shopify way: `currentColor` (and `width="100%" height="100%"` or a `viewBox`) in the file; color/hover classes on the parent; sizing via a wrapper `<span class="size-5">`, a `[&_svg]:size-5` child selector, or in-file dimensions. Liquid-style params (`{#svg 'path', class: '…'}`) remain a reserved, backwards-compatible future extension.

**Cost model, stated plainly:** each `{#svg}` use embeds its own copy of the string in the bundle — identical to hand-pasting, right for small icons. A huge SVG used many times belongs in `app/public/` as an `<img src>` instead.

**Tooling.** `pzlc` grew `--assets <dir>` (default: the nearest ancestor `app` directory's `assets/`). `puzzle init` scaffolds `app/assets/icons/heart.svg` and uses it in the default template's `Home.pzl`. Related but distinct: `import data from './x.json'` in `<scripts>` has always worked (esbuild's built-in JSON loader) — see DOC-PUZZLE-FILE.

## 19. Route snapshot in `data()`: `this.route` (v1.15)

The route source that is correct **inside the navigation**. Shipped in v1.15 (D47); a router + PuzzleView amendment — no compiler, store, or ViewManager changes. The motivating case is the active-nav highlight (the Stays account tabs): on a sibling-pane swap the nav-owning view is a **reused ancestor** (§9 nested routes), and its `data()` re-runs as the pre-commit D19 gate — at which point `window.location` still holds the OLD URL and `router.current` the OLD committed state. A highlight derived from either lands exactly one navigation behind (and `location.pathname` was never right in hash mode, or meaningful in memory mode, anyway).

```js
// AccountShell.pzl — reused ancestor hosting Profile/Trips/Wishlist at <Slot/>
data(params, props) {
  const name = this.route.route.name; // the navigation THIS data() run is gating
  return {
    isProfile: name === 'account-profile',
    isTrips:   name === 'account-trips',
    isWishlist: name === 'account-wishlist',
  };
}
```

**Semantics.**

- `this.route` is `{ path, route, params, chain }` — **the same shape as `router.current`** (`route` = the leaf route node, `chain` = the root→leaf node list) — but it describes **the navigation that delivered this view's params**, not the committed state. Inside a gated `data()` run it names where the navigation is *going*; `router.current` still names where the app *is*. The two agree again the moment the navigation commits.
- The router threads one **frozen** snapshot per navigation through every gated `preload()`/`refresh()` (fresh views and reused ancestors alike) and through the reused layout's post-commit refresh. It rides the same channel as `params` — snapshot and params always describe the same navigation, in every router mode (history/hash/memory) and on push, pop, and initial navigation alike.
- A **store-change** re-run (`refresh()` with no arguments) keeps the stored snapshot — `this.route` only moves when a navigation delivers a new one.
- `this.route` is `null` for components the router does not manage (a plain component mounted by a parent template). Non-routed components that need route state should receive it as props from their routed ancestor.
- **Failure semantics are inherited from params, not widened:** a failed or superseded navigation still changes neither the URL nor `router.current` (D19). A reused ancestor whose sibling's `data()` later rejects has, however, already refreshed and re-rendered with the target's params *and* snapshot — the pre-existing, documented D19/D30 soft-violation, with `route` now riding alongside `params`.
- **Ordering fix that shipped with it:** a reused root layout's post-commit refresh now runs **after** `#commitState` (matching the params-only branch), so `router.current` read from a layout's `data()` is never stale either.

**Matching idiom, stated plainly:** compare **route names** (`this.route.route.name`, or `this.route.chain[0].name` for "which section am I in") rather than string-comparing `this.route.path` — names are immune to query strings, `#anchor` suffixes (D41), and mode differences. `path` is the raw pushed path and may carry both.

**What v1.15 deliberately does not add:** a reactive `router.current` (reading it in `data()` would subscribe the view and re-run post-commit — rejected for the double `data()` run and new store machinery; may layer on later as its own decision) and a `router.isActive(path)` matcher (pure sugar over `this.route`, deferred until real demand — see D47).

## 20. Schema validation enforcement (v1.16)

The rules stored by the §7 builders since v1 now enforce. Shipped in v1.16 (D48); a store/model amendment — no compiler, router, or view changes.

**Enforcement boundaries (always-on where rules are declared):**

- `store.createRecord(type, data)` validates after schema defaults and primary-key generation are applied. On failure nothing is inserted, notified, or persisted.
- `record.update(patch)` validates **only the fields present in the patch** (rules are per-field, so this is exact). On failure the record is untouched. Applies to store-attached and store-less records alike — the rules live on the class.
- Both throw **`PuzzleValidationError`** (exported from the package root): `err.errors` is `[{ field, rule, message }]` in schema-declaration order; `err.message` is the first error's message. The return-the-record contract of both methods is unchanged on success.
- **Exempt by design:** `loadAll`/`loadOne` upserts (the server is authoritative — backend drift must not crash the read path) and storage hydration (fail-soft startup, same posture as the duplicate-pk skip).

**Renderable surface (non-throwing):** static `Model.validate(data)` and instance `record.validate()` return `{ valid, errors }` with the same errors shape — validate first in form UX, then write. There is no persistent `record.errors` state (rejected in D48).

**Rule semantics** (no type coercion — rules compare what they're given):

| Rule | Fails when |
| ---- | ---------- |
| `required` | value is `undefined`, `null`, or `''` |
| `min(n)` / `max(n)` | `.length` outside the bound for strings/arrays; value outside the bound for numbers/dates. **Type-aware since §35:** on a field *declared* `number()`/`date()`, a value of the wrong runtime type (e.g. a form-bound string `"150"`) fails with a type-mismatch message (`"age" must be a number`) instead of silently measuring `.length` — forms must convert before writing. `NaN`/invalid `Date` remain incomparable passes. |
| `oneOf([...])` | value is not strictly (`===`) one of the listed options |
| `validate(fn)` | `fn(value)` returns falsy — a **thrown** exception propagates (broken validator = programming error) |

`required` runs first per field and short-circuits that field's remaining rules; a non-required field whose value is `undefined`/`null` skips its remaining rules; all failing fields are collected. Type mismatches on `string()`/`array()` fields are **not** validated (a number in a `string()` field passes bounds by coincidence of the length branch). Default messages (no `message` arg) name the field and the bound.

## 21. Model relationships: `hasMany` / `belongsTo` (v1.17)

The schema entries reserved since §7 now resolve. Shipped in v1.17 (D49); a store/model amendment — no compiler, router, or view changes.

```js
// post.js
static schema = {
  id:       Puzzle.string().primary(),
  authorId: Puzzle.string(),
  author:   Puzzle.belongsTo('user'),      // infers key 'authorId' from the relationship name
  comments: Puzzle.hasMany('comment'),     // infers key 'postId' from the OWNER's registry type
};
```

- **Resolution is a lazy store query.** `post.author` ⇒ `findOne('user', post.authorId)` (`null` on miss/no store); `post.comments` ⇒ `findMany('comment', { filter: c => c.postId === post.id })` (`[]` when store-less; store insertion order — sort in `data()`). No materialization, no caching: always the live store.
- **Reactivity rides the existing tracking:** a traversal inside `data()` auto-subscribes exactly like the manual join it replaces. Template-only access reads without subscribing — return traversals from `data()`.
- **FK convention, overridable via `{ key: '...' }`:** `belongsTo` → `<relationshipName>Id`; `hasMany` → `<ownerTypeName>Id` (the owner's model-registry key).
- **Relationship entries are not fields:** excluded from defaults, primary-key lookup, and §20 validation; not serialized by `toJSON()` (records serialize the FK, never the resolved graph). Getters are installed by the Store constructor for registered models.
- **The property name is reserved:** assigning to it (e.g. an embedded `{ author: {...} }` server payload) warns once and is ignored — set the FK field instead.

## 22. Adapter write sync (v1.18)

The write half of the D21 adapter story. Shipped in v1.18 (D50); a store/model amendment — no compiler, router, or view changes. The same `static adapter = { endpoint }` declaration drives everything; local mutation semantics (`createRecord`/`update`/`destroy`) are byte-identical to v1 — **sync is a separate, explicit verb.**

```js
const todo = store.createRecord('todo', { text: 'Ship v1.18' }); // local, instant (unchanged)
await todo.save();                    // POST apiURL+endpoint (first save) / PUT endpoint/:id (thereafter)
todo.update({ completed: true });     // local, instant (unchanged)
await todo.save();                    // PUT
await todo.delete();                  // DELETE endpoint/:id, then local remove on ack
await store.request('todo', `/${todo.id}/archive`, { method: 'POST' }); // custom endpoints
```

- **`record.save()`** — validates first (§20): invalid rejects with `PuzzleValidationError`, no request made. POST for a never-synced record, PUT for a synced one (synced = came from `loadAll`/`loadOne`/an upsert, or was saved successfully; **since §35 storage hydration restores the record's real persisted provenance** — a locally-created, never-saved record still POSTs after a reload — with markerless old-format blobs defaulting to synced). A 2xx JSON-object response merges via the exempt upsert path; 204/empty keeps local state. On a **first** save whose response carries a different primary key the store re-keys atomically (the one sanctioned pk change); on an update-save a differing response pk warns and is ignored. A failed save keeps the dirty local state and rejects — retry by calling again. **Reconciliation guards (§35):** a record destroyed (or replaced at its key) while its request was in flight resolves detached — the response is never merged and the record is never re-inserted (local destruction wins); a first-save response whose assigned pk already belongs to a *different* record rejects with a plain `Error` (the HTTP call succeeded; local reconciliation refused), leaving both records untouched.
- **`record.delete()`** — confirmed delete: DELETE first, local remove (normal notify path) on 2xx **or 404** (idempotent); other failures reject and the record stays. `record.destroy()` remains local-only, unchanged.
- **`store.request(type, path, { method, body, headers })`** — the custom-endpoint escape hatch: prefixes `apiURL + adapter.endpoint`, JSON in/out, normalized errors. Idiom: wrap it in model instance methods.
- **Errors:** the new verbs reject with `PuzzleAdapterError` (`.status`, `.statusText`, `.body` when parseable) — exported from the package root. The D21 read path keeps its existing plain-Error messages.
- **Still deferred:** query fault-in (`findMany`'s synchronous pure-local return is load-bearing — its own decision someday), offline queueing, conflict resolution, automatic write-through.

## 23. Router base path (v1.19)

Serve the app under a sub-path with one config line. Shipped in v1.19 (D51); router + config passthrough only.

```js
new PuzzleApp({ target: '#app', routes, models, routerBase: '/myapp' });
```

- **App code stays base-free.** Route definitions, `push('/user/1')`, `router.current`, `params`, and `this.route` never see the base — only the URL carries it. Applied at the path-shape boundary: reads strip it after the mode-specific raw read; writes prefix it before the mode-specific encoding.
- **History mode:** URL is `/myapp/user/1`. The click interceptor intercepts only same-origin URLs **under the base** (stripped on push); same-origin links outside the base fall through to the browser — a real navigation away from the app. Loaded at a pathname outside the base: warn once, pathname passes through un-stripped (typically the catch-all).
- **Hash mode:** the base rides in-fragment — `#/myapp/user/1`; the D41 anchor convention composes (`#/myapp/docs#faq`). With a base set, the exact `#<base>` fragment (→ `/`) and `#<base>/...` fragments are routes; other `#/...` fragments are left to the browser like any non-route fragment.
- **Memory mode:** no URL — `routerBase` is accepted but inert (like `scrollBehavior` there), so one config runs under the test mode.
- **Hrefs are real URLs and carry the base** (`href="/myapp/user/1"`, or relative) — middle-click/copy-link/new-tab must work. `push()` paths never do.
- **Normalization:** leading `/` ensured, trailing `/` trimmed, `''`/`'/'` → no base (default; base-less apps byte-identical). A base containing `#` or `?` is a constructor throw.

## 24. Composition markers: `<children/>` + named slots (v1.21, amended v1.41)

Multi-region composition. Named slots shipped in v1.21 (D53); v1.41 (D74) retired the bare lowercase `<slot/>` and gave each spelling exactly one role: **`<children/>` is the default marker** (call-site children), **`<slot name>` is only ever a named slot** (`name` is now required), and **`<Slot/>` remains the router outlet** (D30). All three compile to the same marker vnode — the runtime kernel, ViewManager expansion, SSG serializer, and router are untouched, and templates already spelled `<Slot/>`/`<slot name>` compile **byte-identically**.

```html
<!-- Card.pzl -->
<puzzle-view class="card">
  <header><slot name="header">Untitled</slot></header>
  <div class="body"><children/></div>
  <footer><slot name="footer"/></footer>
</puzzle-view>

<!-- call site -->
<Card>
  <h2 slot="header">{ post.title }</h2>
  <p>{ post.excerpt }</p>            <!-- no slot attr → default content → <children/> -->
  <Button slot="footer" @click={ open }>Read</Button>
</Card>
```

- **`<children/>` — the default marker.** Renders the invocation's untagged direct children (or, in a routed view/layout, whatever fills the default bucket). Takes **no attributes** (any attribute is a positioned compile error; `ref` gets the render-target message, D72). MAY carry fallback children — `<children><p>Nothing here</p></children>` renders the fallback when the call site supplies nothing (v1.41 un-freezes D53's deferred default-fallback with the exact semantics named slots always had). One default marker per body, counting `<Slot/>` too.
- **`<Slot/>` — the router outlet.** The same marker, capitalized: the canonical spelling in routed shells/layouts (D30 fills it). Bare only — a `name` attribute is a compile error steering to lowercase `<slot name>`, and children remain rejected (no fallback; an index child route is the sanctioned empty-state). The compiler cannot tell a view from a component (same `.pzl` format), so `<Slot/>`-in-views vs `<children/>`-in-components is a documented convention over one mechanism, not an enforced split.
- **`<slot name="x">…fallback…</slot>` — named slots only.** `name` is **required**, static, non-empty, unique per template body; `name="default"` and `name="children"` are reserved (compile errors — the latter steers to `<children/>`). A nameless `<slot>`/`<slot/>` is a positioned compile error naming both replacements. Fallback uses the full template grammar and renders when the call site fills nothing for that name.
- **Call-site side (unchanged, D53):** a **static** `slot="x"` attribute on a **direct child** (element or component tag) of a component invocation routes it to that region; the attribute is stripped from the rendered output. Direct children without one form the default content.
- **Compile errors (unchanged, D53):** dynamic `slot={expr}` on a direct component child; a control-flow block at direct-child level containing top-level `slot`-attributed elements (put the condition inside the slotted element instead). Elsewhere, `slot` is the ordinary HTML global attribute and passes through.
- **Views/layouts (unchanged):** one marker type, one expansion pass — but the router only ever fills the DEFAULT bucket; a named slot in a routed view's template just renders its fallback.
- **Forwarding through a component (v1.38, D71 — respelled by v1.41):** a default marker placed INSIDE a component invocation forwards the enclosing template's default content through that component — `<Card><children/></Card>` in a layout hands the routed page to Card's default slot (`<Slot/>` works identically in that position — same node). The expansion walk substitutes the enclosing template's markers in call-site children before the inner component expands its own; a routed vnode's pinned instance rides along and mounts as usual. Only the default marker forwards: `<slot name="x">` inside a component invocation is a positioned compile error (no defined fill source — the router fills the default slot only), enforced through nested elements, control flow, and deeper invocations.
- Scoped slots (child data flowing back into parent-provided content) remain deferred.

## 25. TypeScript scripts: `<scripts lang="ts">` (v1.22)

Opt a component's logic into TypeScript. Shipped in v1.22 (D54); parser + esbuild plugin + CLI — **codegen and the runtime kernel are untouched**, and a `<scripts>` with no `lang` (or `lang="js"`) compiles byte-for-byte as before.

```html
<puzzle-view class="home"><h1>{ title }</h1></puzzle-view>

<scripts lang="ts">
import { PuzzleView } from '@magic-spells/puzzle';

interface HomeModel { title: string; }

export default class Home extends PuzzleView {
  data(): HomeModel {
    return { title: 'Hello' };
  }
}
</scripts>
```

- **Attribute:** the only attribute `<scripts>` accepts is `lang`. `lang="ts"` → TypeScript; **absent or `lang="js"` → JavaScript** (identical to pre-v1.22). An unknown value, empty value, dynamic `lang={…}`, or a second attribute is a **positioned compile error** (with a did-you-mean for near-misses like `"typescript"`). The Go compiler still treats the `<scripts>` body as an **opaque string** — it never parses TS (D3).
- **Transpile-only (like Vite):** esbuild strips types during the build; there is **no type-checking in the build**. Use `tsc --noEmit` or an editor for type safety. The generated render tail + injected import are plain JS (valid TS), so one loader covers the mixed module: the plugin sets `Loader: LoaderTS`; standalone `pzlc` runs esbuild's Transform API to strip types.
- **`.pzl` stays the only extension** — a `.pzt` alias was considered and deferred (D54).
- **Typings:** the package ships `types/index.d.ts` (all four exports + config/store/router/formatters, wired via `exports.types`) and a `puzzle-env.d.ts` shim (`declare module '*.pzl'` → `typeof PuzzleView`) so `import X from './X.pzl'` resolves. `puzzle init --typescript` scaffolds a strict/noEmit `tsconfig.json`; the default stays JS. `examples/typed-todos` is the worked example.
- **Authoring note:** under `strict`/`noImplicitAny`, annotate `data(params, props)` and event-handler params explicitly — TypeScript does not apply contextual typing from a base-class declaration to a subclass class-body override.

## 26. Overlapping route transitions (v1.24)

Opt-in concurrent route transitions — the old view's `out` and the new view's `in` play at the same time (cross-fades, shared-axis slides). Shipped in v1.24 (D56); router + PuzzleApp config passthrough only. **Sequential stays the default**: a config without `transitionMode` behaves byte-identically to v1.23.

- **Config:** `transitionMode: 'sequential' | 'overlap'` on the PuzzleApp config (amending the §2 surface like `scrollBehavior`/`routerMode`). App-level default; since v1.30 also resolvable per-route (routes.js) and per-view/layout (a class field), destination-only — see §33 (D65).
- **Positioning (wrapper-free, D28 holds).** At out-start the router pins the outgoing animator's root **in place** with inline styles — `position: fixed` at its measured `getBoundingClientRect()` (plus `margin: 0`, `pointer-events: none`) — and mounts the incoming chain into the layout slot in the same synchronous block. No wrapper element is ever injected; in-flow content never stacks or jumps. The pinned leaver paints above in-flow content (it is positioned), and clicks pass through it to the live view.
- **Sequencing.** The out is started but **not awaited**: the location commit + mount proceed immediately in the same synchronous window (`data()` was already awaited before the swap — D19; since v1.28 the URL/title commit rides that window in both modes, §30/D61 — in overlap it simply isn't delayed by the out animation, which is the mode's point). The leaver is destroyed when its `out` settles. Enter stays fire-and-forget as in §12.
- **Hooks in the overlap window:** `viewWillHide()` fires at out-start; the new view's `mounted()`/`viewWillShow()` fire while the old view is still fading; `viewDidHide()`/`viewDidShow()` fire as each animation settles — their **relative order is unspecified**. Sequential mode's §12 ordering is untouched.
- **Interruption stays instant:** a navigation arriving mid-overlap tears the still-fading leaver down synchronously (the §12 posture) — at most two route elements ever coexist.
- **Unchanged:** initial navigation, params-only navigations, memory-mode semantics, reduced-motion (zeroed durations make overlap effectively instant), navigation-failure recovery (a doomed navigation never pins — the out only starts after `data()` resolves).
- **Constraints:** ancestors of the mount container must not carry `transform`/`filter`/`contain` (they'd re-root the `fixed` pin — the containing-block trap); document height snaps to the new view at commit (a cross-fade hides this); combining with a registered morph handler (§ D55) is best-effort — pick one mechanism per app.

## 27. Dev HMR: state-preserving reload (v1.25)

`puzzle dev`'s live reload preserves app state across rebuilds. Shipped in v1.25 (D57); dev server client + runtime dev hooks, **zero production cost** (the `__PUZZLE_DEV__` build define is `false` in production builds and every guarded branch is minified away). Editing a `.pzl` mid-flow — modal open, form half-filled, deep in a nested route — no longer resets the app.

- **Mechanism: reload + transplant, not module swap.** Every rebuild still runs the fresh full bundle via `location.reload()` (no stale closures, no partial module graphs). Immediately before reloading, the injected SSE client calls the dev-published `window.__PUZZLE_APP__.__devSnapshot()`, which writes a one-shot `sessionStorage` blob (`__puzzleHMR`); the freshly booted app restores it **in two phases (§35)**: the store transplants after `beforeMount` but **before navigation #0** (so the initial route's `data()` queries see the restored records on first paint — restoring after `start()`, as v1.25 did, left store-derived views empty until the next mutation), then view-local state restores once the chain has mounted.
- **What survives:** store contents (serialized in the `_persist()` wire shape, hydrated validation-exempt and — since §35 — in identity-preserving **replace mode**, so the snapshot wins over user-configured `storage` on pk conflicts while subscribers' record references stay valid), every mounted view's **local layer only** (`setData` + `created()`-seeded state, filtered through a conservative JSON-safe walk — functions and DOM nodes are dropped; since the §35 two-layer split, `data()`-derived model values are deliberately *not* snapshotted and are recomputed against the transplanted store), the route (the URL itself), and scroll (§14/v1.10 already persists it).
- **View-state identity:** `${class name}:${per-class mount index}` — deterministic across the reload because the same URL mounts the same chain in the same order. A mismatch simply cold-starts that view (fail-soft).
- **The edited component's state survives too** (restore-all — keeping a form's state while editing that form's template is the point); a shape mismatch self-heals on the next edit.
- **Bounds:** the blob is one-shot (deleted on read) and expires after ~10s, so a manual F5 cold-starts; memory mode is exempt; focus/text-selection are lost across the reload; DOM islands (§17) re-seed. Every restore step is fail-soft — corrupt blob, missing view, storage error → cold start, never a crash.

## 28. List keying (v1.26)

How `{#for}` rows get their reconciliation keys. Shipped in v1.26 (D58); codegen + one ViewNode static, byte-identical emission for range-form loops and for `key` attributes outside loop roots.

- **Auto-key is primary-key-aware.** An item-form `{#for item in items}` body root gets a synthetic `key: ViewNode.keyOf(item)` (previously the hardcoded `item.id`). `ViewNode.keyOf` resolves at render time: a store record (a `PuzzleModel` instance) keys by its model's `primaryKey()` field — so `Puzzle.string().primary()` on `main_id` keys lists by `main_id` with no template change — and any other value keys by `.id` exactly as before. `keyOf` is internal surface (like `SLOT_TAG`): compiled output calls it; app code shouldn't.
- **Explicit key overrides.** A `key={ … }` attribute written on the `{#for}` body root (element or component, item or range form) **replaces** the synthetic key — the compiler skips its prepend; the author's expression is used verbatim (`keyOf` is not applied). This is the sanctioned escape hatch for non-record data with a different identity field. Keys must be stable and unique across the collection. (Previously an explicit key silently emitted a **duplicate** `key:` property alongside the synthetic one — that hazard is gone.)
- **Null keys warn.** When `keyOf` resolves `null`/`undefined` (no `.id`, unmodeled data), it warns once — naming the offending item shape — and returns null, so the list degrades to positional diffing **diagnosed** instead of silently. The existing duplicate-key warning (§ v1.23 review pass) is unchanged and covers the colliding-values case. Production builds already strip `console.*`; the warning is dev-only in effect.
- **Range form unchanged:** range/counter loops key by the generated number (unique by construction) with byte-identical emission to v1.25.

## 29. Scoped styles: `<styles scoped>` (v1.27)

Opt-in per-component style scoping via native CSS `@scope`. Shipped in v1.27 (D59); parser + codegen root-stamp + plugin CSS collector. **A `<styles>` block without the attribute emits byte-identically to v1** — global CSS, as always.

- **Grammar:** `scoped` is a **bare, static** attribute and the only one `<styles>` accepts — same posture as `island` (§17) and `min-duration` (§16). A valued or dynamic `scoped`, or any other attribute, is a positioned compile error (did-you-mean when close). One `<styles>` per file, as before.
- **Semantics:** the block's rules match only inside this component's own rendered subtree — two components with colliding selectors in scoped blocks do not affect each other. Scoping is **outward containment, not inward**: rules still cascade into nested child components like ordinary CSS (no hard boundary in this cut); a child's own scoped rule at equal specificity beats the parent's via `@scope` proximity.
- **Mechanism (the compiler never parses CSS):** a stable scope id is derived per file (`pzl-` + 8-hex FNV-1a of the compiler-relative, slash-normalized path); the template root vnode gains one static `data-<scopeId>` attribute (root-only — the cascade covers descendants; view-mode skeletons reuse the root's attrs and are covered); the collected block is emitted wrapped as `@scope ([data-<scopeId>]) { … }`, verbatim inside. The styles pipeline (§13, Tailwind) is untouched.
- **Browser floor:** `@scope` ships verbatim in the bundle — Baseline engines (Chrome/Edge 118+, Safari 17.4+, current Firefox). An engine without `@scope` treats the block as global (v1 behavior), never breakage.
- **Renaming a `.pzl` changes its scope id** (path-derived) — harmless; the stamped attr and the CSS move together in the same build.

## 30. Atomic location commit (v1.28)

The router's location side effects — `pushState`, `document.title`, the memory-mode stack/index, and the outgoing scroll-position save — commit **inside the swap's synchronous commit window, immediately before the incoming mount** (D61). One synchronous block now moves URL, title, DOM, and router state together. This restores D19's stated guarantee ("URL and view commit atomically") that v1.1's sequential transitions had silently stretched: from v1.1 through v1.27, URL/title moved the instant loads resolved, *before* the awaited `out` animation.

- **Sequential mode (default):** the commit runs only after the outgoing unit's `out` animation (and any morph-leave) settles and the final navigation-token checks pass. A push **superseded or failed during the out phase commits nothing** — no phantom history entry, no URL/view divergence (the two holes the early commit left open). Observable shift: URL/title update one out-animation later; apps with no `out` animation see no difference.
- **Overlap mode (§26):** unchanged timing — the out is never awaited, so the commit + mount proceed immediately, concurrently with the leave.
- **Params-only navigations:** unchanged timing — no animation is involved; location commits immediately before the state commit, as before.
- **Pop navigations:** the browser already moved the URL (popstate); the commit contributes title (+ memory-mode index) only. A *failed* pop can still leave the browser URL ahead of the rendered view — accepted asymmetry, no history rollback (unchanged from v1).
- **The D19 data gate is untouched:** failed loads still commit nothing; reused ancestors still gate; the §16 skeleton exemption still bypasses only the *data* gate (see the §16 note).
- **Scroll (§14/D33):** the outgoing entry's position is saved at commit (swap) time rather than click time — scrolling during the out animation is remembered.
- **Out of scope, unchanged:** a render/lifecycle exception *after* the location commit (mount throw) can still leave the URL ahead of the view; no rollback machinery exists (D61 rejected it as racy).

## 31. Cached event handlers (v1.29)

Every `@event` site whose handler is **data-independent** — the bare form `@click={ h }`, or the call form when its arguments reference nothing from the render scope beyond `event` (literals, `event`, `this.…`, and JS globals are all fine: they're evaluated at fire time *inside* the closure) — compiles to a per-instance cached closure (D62):

```js
'@click': ((this.__h ??= {})[3] ??= (event) => this.events.h(event))
```

instead of a fresh arrow per render. Handler *semantics* are unchanged (`this.events` lookup still happens at fire time); what changes is **identity** — the same function object is passed on every render of the instance. Consequences:

- **Component callback props now shallow-compare equal across parent re-renders.** A child whose props are all static, cached, or memoized (§32) no longer re-runs `data()` on every parent render — this restores §4's prop-reactivity rule (`data()` re-runs when props *change*), which fresh-closure callback props had made fire on phantom changes since v1.
- **DOM listeners at cached sites stop rebinding per patch** (`patchAttrs` sees an unchanged value). The `:once` spent flag is unaffected — it lives on the element, not the handler function.
- **Call forms that capture render data or loop variables** (`save(draft)`, `remove(card.id)`) still emit fresh closures, byte-identical to v1.28 — their captures genuinely change, and a component receiving such a prop still re-runs `data()` per parent render (correct: the prop really is new).

Site numbering is per-file and deterministic (`render()` and `renderSkeleton()` share the counter), so recompiling an unchanged file stays byte-stable. `this.__h` joins the emitted `__d`/`__f` as a reserved name on component instances.

## 32. `this.memo()` — reference-stable derived values (v1.29)

`PuzzleView` gains one method (D64):

```js
memo(key, deps, factory)
```

Per-instance cache keyed by `key` (string): returns the cached value while `deps` (an array) matches the previous call for that key positionally by `Object.is` (length change = miss); otherwise calls `factory()`, caches, and returns the fresh value. Synchronous; no reactivity semantics of its own — it exists purely to give values returned from `data()` a stable identity across re-runs, because props compare with shallowEqual and object props therefore compare **by reference**:

```js
data(params, props) {
  const { effect = 'carousel' } = this.getData();
  return {
    carouselOptions: this.memo('opts', [effect], () => ({
      effect, loop: true, slidesPerView: 2,
    })),
  };
}
```

This is the blessed pattern for object/array props (inline object literals in templates remain a compile error, §6): build in `data()`, wrap in `this.memo(...)` keyed by the ingredients. Combined with §31, a child re-runs `data()` only when a prop meaningfully changes. `memo` is a reserved method name on `PuzzleView`.

## 33. Per-route / per-view transition mode (v1.30)

`transitionMode` (§26) is resolvable at finer granularity than the single app-wide switch. Shipped in v1.30 (D65); router-only amendment, amends D56. **An app that sets none of this is byte-identical to v1.24–v1.29** — the app-level `transitionMode` option keeps working exactly as before, unchanged in meaning for anyone who never touches the new surfaces.

- **Three tiers, most specific first, resolved fresh per navigation:**
  1. A `transitionMode` field on a route (or child-route) definition in `routes.js`, sibling to `layout`/`meta` (not nested inside `meta` — `meta` is reserved for page-metadata like `title`; `transitionMode` is structural, like `layout`). Resolved by a **nearest-defined walk of the destination chain, leaf → root** — the exact walk `meta.title` already uses (§ D19/`#setTitle`) — so a parent route (e.g. a `/settings` shell) can set it once for every child that doesn't declare its own.
  2. A `transitionMode` field on the incoming animator's **view or layout class**, colocated with `animations`:
     ```js
     export default class GalleryView extends PuzzleView {
       transitionMode = 'overlap';
       animations = { in: {...}, out: {...} };
     }
     ```
     Layout classes qualify too — a layout is a `PuzzleView` subclass, and a layout swap's animator is the fresh layout instance, so this field works there unmodified.
  3. The app-level `transitionMode` constructor option (§26), now the **fallback** rather than the sole source.
- **Resolution is DESTINATION-ONLY.** For a navigation A→B, only B's configuration (across all three tiers) is ever consulted — A's own `transitionMode` (route or view field) has no bearing. The reverse navigation B→A is resolved independently and may play differently. This mirrors how `meta.title` and each view's own `animations.in` already work: the side being entered unilaterally controls its own arrival.
- **Why destination-only, not per-view generally:** D56 explicitly deferred a per-view override because a transition spans **two different instances** with no shared owner — letting either side's field win invites "spooky cross-view action" (one view's declared field controlling how a *different* view's animation plays). Resolving it directionally removes the ambiguity by construction: it is never a live negotiation between two sides, only a lookup on the side being entered. Generic nested/reusable components (`Button.pzl`, `Card.pzl`, …) are out of scope by construction, not by omission — D30's one-animator rule guarantees only a routed view or layout is ever consulted; everything else is `skipEnter()`'d during a route swap and never asked.
- **Validation:** an unknown route-level `transitionMode` value is a **construction-time throw**, same posture as the unknown-`transitionMode` constructor check (§26) and the other route-shape throws (bad child path, `layout` on a non-root node, etc.). An unknown view/layout-level field value **warns once per offending class** and falls through to the next tier, rather than throwing — a single misconfigured view must not crash navigation.
- **Unchanged:** everything else about §26/§30 — positioning, sequencing, hook ordering, interruption, the D61 atomic-commit window, morph interop, reduced-motion. This amendment only changes *which* of sequential/overlap is selected per navigation, never how either mode itself behaves.

## 34. App lifecycle hooks (v1.31)

Three optional function fields on the PuzzleApp config — the sanctioned home for app-level setup (store seeding before the first render) and teardown (persistence flushes). Shipped in v1.31 (D66), the triage outcome of the app-surface umbrella: **only lifecycle hooks were admitted**; app-level `settings`/`computed`/`methods`, global events (incl. keyboard-shortcut strings), the `$events` bus, `ctx.utils`, and a devtools hook stay re-rejected (see the cut list and DECISION-D66). All fields optional — an app using none behaves byte-identically.

```js
const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  async beforeMount(app) {
    // services are wired, navigation #0 has NOT run: seed here and the
    // first data() sees real records (retires `app.mount().then(seed)`)
    seedTasks.forEach((t) => app.store.createRecord('task', t));
  },
  mounted(app) {
    // initial route rendered (and dev HMR state restored)
    window.addEventListener('beforeunload', persist);
  },
  beforeUnmount(app) {
    // teardown not started: the store is still readable
    persist();
    window.removeEventListener('beforeunload', persist);
  },
});
```

- **`beforeMount(app)`** — runs inside `mount()` after the three ctx services are wired (`app.store`/`app.router`/`app.formatters` live), immediately before `router.start()` (navigation #0). **Awaited**: an async hook completes before the first `data()` runs. A throw or rejection **aborts the mount** — the app is torn back down to the unmounted state and `mount()` rejects with that error (re-mounting later is legal; `beforeUnmount` does not fire on this abort path). An `unmount()` during an in-flight async `beforeMount` wins: the router never starts.
- **`mounted(app)`** — runs after the initial route has rendered and the dev HMR restore (§27) has applied. **Not awaited**; a throw or async rejection is caught and logged (`[puzzle]` prefix), never rejecting a mount that succeeded (same posture as morph-handler errors, D55).
- **`beforeUnmount(app)`** — runs at the top of `unmount()`, before any teardown, with services still live. Only fires when actually mounted (idempotent `unmount()` never double-fires). Synchronous call: a returned promise is not awaited and cannot delay teardown; a throw is caught and logged and teardown proceeds. A returned promise's **rejection** is likewise observed and logged (§35) — never an unhandled rejection.
- Each hook receives the app instance as its argument (`this` is also the app for `function`-form hooks). Hooks re-fire on every mount/unmount cycle. A non-function, non-nullish hook value throws at `mount()` time, before any wiring.
- `beforeMount` delays navigation #0 by design — seed local data there; a slow network fetch belongs in view `data()` behind a `<puzzle-skeleton>` (§16), which cannot render during `beforeMount`.

## 35. 0.1.0 release hardening (v1.32)

The pre-release hardening bundle (branch fix/pre-0.1.0-hardening): correctness fixes plus three deliberate semantic changes, decided before the API ossifies under external users. Amendments are annotated inline in the sections they change (§4, §6, §20, §22, §27, §34); this section is the index.

**Semantic changes (deliberate):**

- **Two-layer component state** (§4 class contract): `data()` results now REPLACE the model layer wholesale instead of merging forever — omitted keys drop; `setData` state lives in a persistent local layer underneath. Precedence: a `data()` commit beats an earlier `setData`; a later `setData` beats the model until the next commit. Nothing in the shipped examples relied on key accumulation (zero test updates needed).
- **Type-aware validation bounds** (§20): declared `number()`/`date()` fields reject wrong-runtime-type values in `min`/`max` instead of measuring string length.
- **Persisted sync provenance** (§22, §8 wire shape): `_synced` rides out-of-band (`__synced`) in the persistence blob; hydration restores real provenance instead of assuming synced.

**Correctness fixes (no intended semantic surface):** schema object/array defaults deep-clone per record; save-boundary reconciliation guards (destroy-wins, pk-collision refusal — §22); `mounted()` defers to the first landed commit when a prop update supersedes the initial async `data()` (never fires against the placeholder anchor); router-owned mount rejections observed; deferred redirect pushes survive a sync commit throw; memory-mode `go()` chains synchronous calls correctly; `beforeUnmount` thenable rejections logged (§34); two-phase HMR restore (§27); formatter fail-soft (invalid decimals/dates/locales/time zones). Compiler: empty/Vue-dotted event names are positioned errors with did-you-mean (§5); failed one-shot builds no longer wipe the last good `dist/` (staging swap); template reads of `<scripts>`-imported names warn (§6 expression boundary); MixedAttr `key=` suppresses the synthetic key (§28); classname extraction is comment/string-aware; `{#svg}` rejects backslash paths (§18).

**Distribution (new, no runtime change):** `@magic-spells/puzzle` ships a `bin` shim resolving per-platform binary packages (`@magic-spells/puzzle-{darwin-arm64,darwin-x64,linux-x64,linux-arm64}`) from `optionalDependencies` — one `npm install` yields runtime + CLI; release workflow stamps `puzzle --version` via ldflags and publishes platform packages before the root. `go install` remains the unsupported-platform fallback.

## 36. Static output — `output: 'hybrid' | 'static'` (v1.33; amended v1.46/D79)

An additive build OUTPUT mode that prerenders every static route to its own HTML file. It amends D1's scope, not its architecture: there is still no SSR server and no hydration protocol, and the Go parser/codegen are untouched (compiled `.pzl` output was already environment-agnostic ViewNode-tree data). **D79 splits this into two output modes** that share one serializer, one prerender orchestrator, and one chain assembler (`client-runtime/ssg/assemble.js`):

- **`hybrid`** (D67, formerly spelled `static` — behavior byte-identical): prerendered pages **plus** the shared `/app.js` SPA bundle; the browser runtime replaces the prerendered DOM at navigation #0 and the site is the same SPA thereafter (morph, transitions, routing unchanged after takeover).
- **`static`** (D79): a **true static site** — prerendered pages with **no router, no SPA takeover, and no history API** in the output. Navigation is plain `<a>` page loads and `dist/` contains no `app.js`; each page ships a small per-page module that mounts only its own components.

**Activation:** `puzzle build --static` / `--hybrid`, or `output: 'static'` / `'hybrid'` in `puzzle.config.js` (those are the only two legal values; anything else is a config error). The two flags are mutually exclusive, and a flag disagreeing with the config value is an error. Either flag or config key is sufficient. `puzzle dev` and a plain `puzzle build` (no `output`) are unchanged (SPA).

**Shared prerender pipeline:** after the normal bundle + Tailwind + `public/` copy into the staging dir, the CLI bundles a second node-platform entry (same `.pzl` plugin, `__PUZZLE_DEV__=false`) that imports the app's **default-exported PuzzleApp** from `app/app.js` (required convention: `export default app`) plus `@magic-spells/puzzle/ssg`, and runs it under `node` once (with the mode passed through). A prerender failure fails the build; the staging swap guarantees the last good `dist/` is untouched. The summary (pages written, skipped routes, warnings) rides a stdout JSON sentinel (`__PUZZLE_SSG_JSON__`), same pattern as the config loader.

**Per-route output** is directory-style in both modes: `/` → `dist/index.html`, `/components/badge` → `dist/components/badge/index.html`. Each page is the `public/index.html` shell with the rendered markup injected into the (required, empty, `#id`-form `config.target`) element and the first `<title>` replaced by the route's `meta.title` (nearest-defined leaf → root; shell title kept when absent). Pages link absolute paths, so they work at any depth.

**Render semantics** (`client-runtime/ssg/`, both modes): each route's layout + view chain is instantiated and loaded via `preload()` — `created()` + awaited `data()`, with `this.route` populated — so **no `mounted()`, no animations, no DOM runs at build time**; `data()` executes once per page under Node (global `fetch` serves adapters; browser globals in module scope must be guarded). `render()` always, never `renderSkeleton()`. The serializer mirrors the ViewManager byte-for-byte where it matters: slot expansion is the SAME `expandSlots`, `@event`/`key`/`island` attrs are dropped, boolean props emit bare attrs, `{#svg}` island seeds emit verbatim, scoped-style `data-<scopeId>` stamps pass through. Principled difference: `value` serializes as an attribute (pre-JS display) where the browser assigns a property. `config.beforeMount` is awaited once with a `{ store, config }` facade — **build-time only in both modes** (the Astro-frontmatter policy).

**Hybrid takeover contract (router):** the target is stamped `data-puzzle-ssg` and pages link the shared `/app.js` + `/styles.css`. On navigation #0, a mount container carrying `data-puzzle-ssg` is cleared (`replaceChildren`), the marker removed, and the incoming top view's enter animation suppressed (`skipEnter()`) — the swap happens inside the commit window after the data gate, with identical markup, so there is no flash and no duplication. Containers without the marker behave byte-identically to v1.32.

**Static contract (per-page modules, D79):** the target is stamped `data-puzzle-static` (never taken over by a router). Codegen stamps every compiled class with `Class.__pzlModule` (its app-root-relative source path); the build (`compiler/internal/build/prerender_pages.go`) generates one per-page ES module `dist/_puzzle/<slug>.js` (slug: `/`→`index`, `*`→`404`, else path `/`→`--`, collisions suffixed `-2`,`-3`…) importing `mountStatic` from `@magic-spells/puzzle/static` plus exactly that page's view/layout/component classes; esbuild code-splitting factors shared components + the router-free view-layer runtime into `dist/_puzzle/chunks/`. Each page's context store is serialized (`store._serializeAll()`) into an inline `<script type="application/json" data-puzzle-static-data>` island; the shell's `/app.js` tag is swapped for the page's module and `staging/app.js` is dropped. `mountStatic` wires the same build-time ctx (Store + FormatterRegistry; `ctx.router` throws), rehydrates the data island (replace mode), assembles + preloads the chain via the shared `assembleChain`, `skipEnter()`s every instance, then `replaceChildren()` + mounts over the prerendered markup — flash-free because it re-renders identically. `models` load from `app/models/index.js` and `formatters` from `app/formatters.js` when those files exist; formatters registered only in the app.js config warn (available at build time, missing client-side).

**Route matching amendment (all modes):** a single trailing `/` is no longer significant — `/docs/` matches the `/docs` route and a `:param` capture never swallows the slash. Static hosts serve directory URLs (`/components/badge/`), so the prerendered pages' own load paths must match their routes.

**404 (v1.34):** the top-level catch-all route (`path: '*'`, D19) renders to `dist/404.html` — the file static hosts (GitHub Pages, Netlify, Render, Cloudflare) serve for unknown paths — with the same preload/serialize/title/marker treatment as any page (`prerender: false` on its chain writes the plain shell there instead). A build with NO catch-all emits an advisory warning that unknown URLs will get the host's default 404. In `hybrid` mode the live router additionally serves this view for unmatched client paths; in `static` mode there is no client router, so the file is what serves unknown URLs. The `puzzle init` templates (default and todos) ship a `NotFound.pzl` view wired as the catch-all.

**Boundaries:** dynamic routes (`:param`, and any non-catch-all `*` pattern) are skipped with a build warning in both modes (a static build has no way to run them client-side either — dynamic content in static mode awaits `staticPaths()` or a `prerender: false` runtime-fetch island). `prerender: false` anywhere in a route chain writes the plain shell at that path — an SPA island in hybrid mode, a client-rendered island (data island + entry module, no marker) in static mode. Deferred on top: a `staticPaths()` enumeration hook, a head-management API (per-route meta/og), DOM-adoption hydration, a true zero-JS per-route opt-out for static mode, lazy route views + code splitting, `puzzle preview`, and flat `name.html` output as a config knob.

## 37. Cross-view morphs — sibling-swap capture flights in `enableMorph` (v1.35)

An amendment (D68) to the v1.23 shared-element morph integration (D55 — whose base contract lives in its decision card; morph predates numbered SPEC sections). Elements sharing a `data-puzzle-morph` value now morph across **sibling view swaps** automatically — both directions, pops included — with no app code beyond the existing `enableMorph(app)`. Default-on, no new options, no new dependencies.

**The gap:** D55 pairs only elements that coexist in the DOM (nested-route dialogs, where the source stays mounted). Sequential transitions (D28) destroy a sibling view before its replacement mounts, so a list→detail navigation had no pairing moment; the music example bridged it app-side with a capture-at-click helper (`art-morph.js`, forward-only, per-card handlers).

**The mechanism (all in `client-runtime/morph.js` — the router is untouched, D55's one-slot posture holds):**
- **Capture at leave.** The handler's `leave(el)` fires at out-phase start while the outgoing subtree is still connected and measurable. After the unchanged D55 fly-back logic, it snapshots every measurable `[data-puzzle-morph]` element in the leaving subtree (`Map<id, {el, rect}>` — detached refs stay cloneable after destroy). This is what makes back/forward pops and programmatic navigations morph.
- **Click candidate (polish).** One delegated capture-phase document click listener records a candidate ref (+timestamp; zero DOM work; `typeof document` guard for the D67 node prerender). If fresh (<5 s) and inside the leaving subtree, `leave()` pins a fixed-position clone over it pre-fade (morph attribute stripped from the clone; 2 s TTL fade) so the art visually holds still while the old view animates out.
- **Fly at enter.** `enter(el)` scans all morph elements in the entering subtree. A live counterpart outside the subtree wins (existing D55 pair + fly-back path — unchanged priority); otherwise the first element whose id matches a capture gets a **clone flight**: the pinned clone if ids match, else a clone built pre-paint from the snapshot at its recorded rect. Clone flights are one-shot — they never set the fly-back pair; the reverse trip comes from the next leave's fresh capture. Post-settle unwind: the clone is always removed; `engine.stop()` only when `show()` settled true (false = superseded by a newer flight that owns the engine).
- **Skeleton-deferred targets.** If captures exist but the entering subtree has no morph element yet (§16 skeleton views — the real template lands after `data()`), a MutationObserver scoped to the animator element waits (2 s TTL) for a measurable matching element and then flies.
- **Cleanup.** Captures are per-navigation (discarded at the next leave/enter); a failed or superseded navigation (D61: nothing commits, enter never fires) is cleaned by the pinned clone's TTL. `prefers-reduced-motion` disables all capture; `options.attribute` flows through every selector.

**Rules:** D55's element rules apply, plus the capture-flight target's view should declare an opacity-only `in` animation (or none) — the engine measures the target rect once at flight start, so a transform entrance slides the real element away from where the blob lands (documented, not enforced). Still one flight per transition and one shared engine. Deep links (navigation #0) never morph.

**Directional morph roles (v1.36, D69):** three spellings share one id namespace. Plain `data-puzzle-morph="id"` is the symmetric surface — launches AND receives, the D55/D68 default, unchanged. `data-puzzle-morph-trigger="id"` launches only (eligible for leave snapshots, click-pins, and as a live-pair source; never a landing spot). `data-puzzle-morph-target="id"` receives only, and is **preferred over a plain element** when the same id appears more than once in the arriving view (a detail header beats a featured card lower in the page) — it never launches anything, including as a live-pair source. Ids match across all three, so trigger→target pairs are automatically **forward-only**: list→detail morphs, detail→list renders plainly. Direction is a property of the element (the flight shape), not of history — back-shaped pushes behave identically to pops. When multiple triggers share an id in the leaving view, the clicked one launches; document order breaks ties otherwise, and a warn-once duplicate-id guard teaches the resolution (silent for the endorsed trigger+target pattern). All three spellings derive from an `options.attribute` override (`data-x` → `data-x-trigger`/`data-x-target`). Symmetric plain↔plain pairs keep the full D55 round-trip contract.

## 38. Element refs — `ref="name"` → `this.refs` (v1.39)

A static `ref="name"` attribute on a **plain element** binds that element's live DOM node to `this.refs.name` on the owning view (D72). The attribute is framework-owned — stripped from the DOM like `key`/`island` — and the name must be a bare identifier (it becomes a property of `this.refs`).

**Lifecycle contract:** `this.refs.name` is the mounted element, `null` when not mounted. Populated during mount, **before `mounted()` fires** — usable there with no guard. A keyed or tag replacement **re-points** the ref at the new element; removal (an `{#if}` toggling off, a list row leaving, view teardown) nulls it. Outside `mounted()`, guard with `?.` — the same discipline as the `@ready` idiom. `refs` is an instance field, not render data: never in `getData`/`setData`, never in HMR snapshots (§27), dropped by the SSG serializer (§36) like `@event`/`key`/`island`.

**Compilation:** codegen emits `ref: this.__ref("name")` in the vnode attrs — `__ref` returns a per-instance **cached** setter (stable identity across renders, the §31 lesson applied at birth), with a guarded-removal signature that makes patch-time mount/remove ordering irrelevant. The ViewManager stays view-agnostic: like event handlers, the closure carries the view. `refs` and `__ref` join the §4 reserved names.

**Compile errors (all positioned):** dynamic `ref={ expr }` or mixed/interpolated value (the §6 expression boundary makes a braces form unimplementable — identifiers in braces are data reads); empty or valueless `ref`; a non-identifier name; `ref` on a component tag (use the `@ready` callback prop — a component's root element is its own business); on `<slot>`; on the `<puzzle-view>` root (that's `this.element`); inside `{#for}` (per-iteration array refs deferred); inside `<puzzle-skeleton>` (skeleton nodes die at the real-template swap); duplicate ref names in one template.

**The headline combo is `ref` + `island` (§17):** `<svg island ref="scene">` + a rAF loop in `mounted()` is the sanctioned zero-diff animation path — the ref delivers the node, the island guarantees hand-mutations survive every re-render, and per-frame work never touches render/diff.

## 39. Scroll-triggered enter animations — `trigger: 'visible'` (v1.40)

An `in` spec (§12) accepts two additional optional keys (D73): `trigger: 'mount' | 'visible'` and `triggerOffset`. Absent or `'mount'` is today's behavior, byte-identical. With `'visible'`, the enter animation does not play at mount — the element is **held at its `from` keyframe** (a paused WAAPI animation; `fill: 'both'` holds the pre-state, so there is no flash of natural-state content) and plays **once**, the first time the element enters the viewport.

```js
animations = {
  in: {
    from: { opacity: 0, transform: 'translateY(24px)' },
    to:   { opacity: 1, transform: 'translateY(0)' },
    duration: 500,
    easing: 'ease-out',
    trigger: 'visible',
    triggerOffset: '15%',   // optional — trigger line above the viewport bottom (px number or '%' string)
  },
};
```

**Observation.** A module-level registry (`client-runtime/views/visibility.js`) keeps **one shared IntersectionObserver per distinct rootMargin**, threshold 0, and disconnects an observer when its last target disarms. `triggerOffset` maps to `rootMargin: '0px 0px -<offset> 0px'` — the trigger-line-from-viewport-bottom model adopted from `@magic-spells/scroll-trigger`. An element already in view at mount reveals on the observer's initial callback (~one frame later).

**Anchored triggering.** An optional `triggerAnchor: '<css selector>'` makes the instance observe an **ancestor** element instead of its own root — resolved once at arm time via `this.element.closest(selector)`. All children anchored to the same element reveal in the same frame when it crosses the trigger line (per-child `delay` provides the choreography); the registry holds multiple callbacks per observed element, still one shared observer. Ancestor-only is deliberate: an ancestor's lifetime contains the child's, so anchor teardown can never dangle. No match at arm time → warn once per spec object, fall back to observing the own root (content never stranded behind a typo). `triggerOffset` composes with the anchor. Rows of a `{#for}` share one class and therefore one spec — anchored, they reveal together with identical timing (a per-index stagger knob is deferred). `triggerAnchor` without `trigger: 'visible'` warns once and is ignored.

**Lifecycle.** The `viewWillShow()` → `in` → `viewDidShow()` bracket **defers as a unit** to the actual reveal; `mounted()` timing is unchanged (it fires at mount, before the hold). The reveal runs at most once per mount — scrolling away and back does not replay; a keyed remount is the re-reveal idiom. `playIn()`'s promise stays pending until the reveal completes (or the instance is destroyed) — every caller is fire-and-forget, so navigation is never held open. Fill-release (§12) still applies after the reveal: `to` must equal the natural resting style.

**Degradation — content is never stranded hidden; every failure lands on `'mount'` behavior:** no `IntersectionObserver` global (jsdom, ancient browsers) → play at mount; **`prefers-reduced-motion` → no hold at all** — content renders immediately with the usual zeroed durations, hooks fire at mount; unknown `trigger` value or malformed `triggerOffset` → warn once per spec object, fall back; a WAAPI create/pause/play throw → instant reveal. `destroy()` before the reveal disarms the observer, resolves the pending `playIn()`, and skips the hooks (the destroyed-mid-enter rule). A `trigger` key on `out` warns once and is ignored — a leaving element cannot be visibility-triggered.

**Scope.** Any PuzzleView — components are the point; routed views/layouts are allowed but are normally in-viewport at mount, so `'visible'` simply plays immediately (harmless — the D65 don't-restrict-document posture). Runtime-only amendment: the compiler never parses the `animations` field; ViewManager patch paths, router, and SSG serializer are untouched. On prerendered pages (§36), static markup renders in natural state and below-fold components hold-and-reveal once the page's interactive layer mounts — the router takeover in `hybrid` mode, `mountStatic` in `static` mode.

## 40. Module resolution — the `@` app alias (v1.42)

Every bundled import specifier beginning `@/` resolves to the app's `app/` directory (D75). `import Icon from '@/components/Icon.pzl'` means `<project root>/app/components/Icon.pzl` from any file at any depth — the fix for `../../components/…` climbing once views live in subfolders.

**Contract:**
- **Always on, not configurable.** No opt-in, no `puzzle.config.js` key. `app/` is already the framework-fixed source root (both build paths hardcode the entry as `app/app.js`), so the anchor needs no configuration. A general `resolve.alias` block stays deferred.
- **Bundle-wide.** It applies wherever esbuild resolves a specifier: `.pzl` `<scripts>` blocks, `app.js`, `routes.js`, models, `.ts` files under `<scripts lang="ts">` (§25), JSON imports. All three build paths get it — `puzzle dev`, `puzzle build`, and the separate prerender bundle of `puzzle build --static` / `--hybrid` (§36).
- **Relative paths are untouched.** `./` and `../` imports keep working exactly as before; `@/` is additive.
- **Scoped packages are untouched.** esbuild matches alias keys on segment boundaries, so a bare `@` key catches `@` and `@/…` only: `@magic-spells/puzzle`, `@magic-spells/morph-engine`, and every other scoped package resolve normally. npm cannot publish a package named exactly `@`, so no collision exists.
- **Module resolution only.** It does NOT apply to `{#svg 'icons/x.svg'}` asset paths (already resolved against `app/assets`, §18), to `<styles>` blocks, or to `@import`s inside `styles.css` — different resolvers.

**Implementation:** one entry in the esbuild `Alias` map, set in `configureRuntime` (`compiler/internal/build/options.go`) alongside the existing `@magic-spells/puzzle` runtime entries. Parser, codegen, and the runtime kernel are untouched — this is purely a bundler-resolution concern.

**Editor support:** `puzzle init` writes the matching `paths` mapping — `"@/*": ["./app/*"]` — into `tsconfig.json` (`--typescript`) or an editor-only `jsconfig.json` (plain JS). Exactly one of the two is written, since editors ignore a `jsconfig.json` sitting next to a `tsconfig.json`. Existing apps add the same three lines by hand; the build never reads either file.

## 41. CLI update notification + `puzzle upgrade` (v1.43)

The CLI reports newer published releases and can upgrade itself through the user's own package manager (D76). Two surfaces: a passive one-line notice on `build`/`dev`, and an explicit `puzzle upgrade` command. npm remains the owner of installation — the binary never replaces its own files.

**Passive notice (`puzzle build`, `puzzle dev`):**
- Prints one dim line — `✨ puzzle <latest> available (current <v>) — run puzzle upgrade` — after the build summary (`build`) or the ready banner (`dev`).
- **Entirely skipped** when `CI` or `PUZZLE_NO_UPDATE_CHECK` is non-empty, or stdout is not a terminal. Piped/scripted invocations never touch the network.
- The notice is printed **from cache only**: `<os.UserCacheDir()>/puzzle/update-check.json` (`checked_at` RFC3339 + `latest`). A missing or ≥24h-old cache triggers a background fire-and-forget refresh (3s timeout) — a short-lived `build` may exit before it lands, so the notice appears on a later run. The passive path never blocks a command, never delays exit, and never surfaces network errors.
- Registry endpoint: `GET <registry>/@magic-spells/puzzle/latest` with the `application/vnd.npm.install-v1+json` Accept header. `<registry>` defaults to `https://registry.npmjs.org`; `PUZZLE_REGISTRY` overrides it (mirrors, tests).

**`puzzle upgrade [--check]`:**
- Fetches the latest version synchronously (5s timeout; a failure here IS an error, unlike the passive path). Current ≥ latest short-circuits with `✓ … is up to date`. `--check` reports current vs latest and changes nothing.
- **Install-context detection**, in order: **project** — walk up from cwd to the first `package.json` listing `@magic-spells/puzzle` in `dependencies`/`devDependencies`; the package manager comes from that directory's lockfile (`pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `bun.lock`/`bun.lockb`→bun, else npm) and the dependency field is preserved (devDependencies → `--save-dev`/`-D`/`-d`). **Global** — no project found but the (symlink-resolved) executable lives under a `node_modules` segment: `npm install -g` (or `pnpm add -g` when the path shows a pnpm segment). **Manual/`go install`** — neither: print the `go install …@latest` instruction and exit 0.
- The exact fetched version is installed (`@magic-spells/puzzle@<latest>`, not the `latest` tag), child output streams through, and a non-zero exit propagates with the failed command named. The platform binaries follow automatically — they are exact-pinned `optionalDependencies` of the root package (§35).
- Success is **confirmed**, not assumed: the installed `node_modules/@magic-spells/puzzle/package.json` version must equal the target, then `✓ upgraded <old> → <new>` prints and the update cache is written so the passive notice does not re-fire.

Semver comparison is a minimal in-repo `x.y.z[-pre]` implementation (prerelease sorts before its release, dot-separated identifiers per SemVer §11) — no new Go dependencies.

## 42. Interactive `puzzle init` prompts (v1.44)

`puzzle init` prompts for the choices that were not given as flags, on a TTY only (D77). Amends §13's "non-interactive by design" clause; every other command is untouched.

- **Gate:** the same TTY check the D32 app-name prompt already uses. On a non-TTY (pipes, CI, scripts) behavior is byte-identical to v1.4: no prompts, silent defaults, and a missing app-name argument is still an error — nothing can hang.
- **Prompt order:** app name (existing, only when the argument is absent) → template → TypeScript.
- **Template prompt** — asked only when `--template` was not explicitly passed: offers the embedded template names in menu order (`default`, `todos`); empty input selects `default`; invalid input re-prompts.
- **TypeScript prompt** — asked only when `--typescript` was not explicitly passed: y/N, empty input means No; accepts y/yes/n/no case-insensitively; invalid input re-prompts.
- **Flags win:** an explicitly-passed flag is never re-asked, so `puzzle init my-app --template todos --typescript` stays fully scripted even on a TTY.
- The scaffolded output for a given (name, template, typescript) triple is unchanged — prompts only gather inputs; scaffolding semantics stay §13's.

## Deferred features (post-v1)

Explicitly out of scope for v1. Docs may describe them only if marked **"Planned — not in v1"**.

- ~~Cross-fade / overlapping route transitions~~ — shipped in v1.24 (§26, D56: opt-in `transitionMode: 'overlap'`, fixed-pin positioning). A per-route/per-view override shipped in v1.30 (§33, D65 — destination-only); a per-NAVIGATION (call-site) override remains deferred.
- ~~Named slots~~ — shipped in v1.21 (§24, D53); scoped slots remain deferred. (Event modifiers, `{#unless}`, and multi-branch `{#case}` shipped in v1.7 — D36/D37/D38; the `{#switch}` name was rejected in favor of `{#case}`.)
- ~~Scoped styles (`<styles scoped>`)~~ — shipped in v1.27 (§29, D59: native `@scope` wrapping, root-stamped attribute). A hard child boundary (`to (…)`) remains deferred on top of it.
- ~~Schema validation enforcement, relationships~~ — both shipped: validation enforcement in v1.16 (§20, D48), `hasMany`/`belongsTo` resolution in v1.17 (§21, D49)
- ~~Adapter write sync, custom adapter methods~~ — shipped in v1.18 (§22, D50: `save()`/`delete()`/`store.request()`). Query fault-in remains deferred (re-affirmed in D50).
- App-level `settings`, `computed`, global `events`, `methods` — re-rejected at the D60 triage (module constants / singleton store records / view-scoped listeners cover the observed demand). ~~App lifecycle hooks~~ — shipped in v1.28 (§30, D60: `beforeMount`/`mounted`/`beforeUnmount` on the config).
- Global event bus (`this.$events`), `ctx.utils`, devtools hook — re-rejected at the D60 triage (singleton store records are the bus; the 3-service ctx is a selling point; `window.__PUZZLE_APP__` covers dev introspection, D57)
- Virtual scrolling
- ~~HMR~~ — shipped in v1.25 as a state-preserving dev reload (§27, D57). Per-module hot swap (patching a changed component without a reload) remains deferred on top of it.

## Open questions (tracked, not blocking)

- `Puzzle.string()` vs a dedicated `t.string()`/`field.string()` namespace if `Puzzle` ever needs app-level statics. Starting with `Puzzle.*`.
- Whether `puzzle dev` should also serve `/api` mocks for adapter development (post-v1 concern).
