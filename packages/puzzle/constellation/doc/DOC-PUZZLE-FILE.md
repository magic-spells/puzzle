---
name: .pzl files — user guide
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-PUZZLE-VIEW
  - DOC-SPEC
  - DOC-SPEC-ANATOMY
  - DOC-SPEC-VIEW
  - DOC-USER-GUIDE
  - DOC-DATASTORE
  - DOC-COMPILATION-FLOW
  - DOC-ROUTER
---

What goes in a `.pzl` file and how its class works. The contract is [[DOC-SPEC-ANATOMY]] (§3 anatomy, §4 scripts, §10 context, §25 TypeScript, §29 scoped styles, §40 the `@` alias) and [[DOC-SPEC-VIEW]] (§12 animations, §16 skeletons).

# `.pzl` files

A `.pzl` file bundles a template, its logic and optional styles:

```html
<puzzle-view class="post-list">
  {#for post in posts}<PostCard post={ post } />{/for}
</puzzle-view>

<puzzle-skeleton>
  {#for 1...3}<div class="h-16 rounded bg-skeleton animate-pulse"></div>{/for}
</puzzle-skeleton>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import PostCard from '@/components/PostCard.pzl';

export default class PostList extends PuzzleView {
  data() {
    return { posts: this.ctx.store.findMany('post') };
  }
}
</script>

<style scoped>
.post-list { display: grid; gap: 1rem; }
</style>
```

| Section | Required | Purpose |
| --- | --- | --- |
| `<puzzle-view>` | yes | The template ([[DOC-TEMPLATE-SYNTAX]]). |
| `<puzzle-skeleton>` | no | Shown while the first `data()` is pending (below). |
| `<script>` / `<script lang="ts">` | no | The class. Imports, including other `.pzl` files, go here. |
| `<style>` / `<style scoped>` | no | One per file. Global CSS, or confined to this component's subtree with `scoped`. Tailwind utilities are the default way to style. |

**Views and layouts vs components.** Files under `app/views/` and `app/layouts/` render a real `<puzzle-view>` element with the tag's attributes — the boundary navigation swaps and animations target. Components render **inline**, with no wrapper: their `<puzzle-view>` must carry no attributes, and the template needs a single root element.

## The `<script>` block

The script is plain JavaScript (or TypeScript with `lang="ts"`) handed to esbuild untouched, so editors, ESLint and Prettier just work. JSON imports work (`import config from './config.json'`); SVG icons are inlined with `{#svg}` instead. `@/` resolves to your `app/` folder from any depth (`import Icon from '@/components/Icon.pzl'`).

The exported class extends `PuzzleView`:

| Member | What it is |
| --- | --- |
| `data(params, props)` | Returns the model the template reads. May be `async`. |
| `events` | A class field of arrow functions — the template's handlers ([[DOC-EVENTS]]). |
| `created`, `mounted`, `beforeUpdate`, `afterUpdate`, `destroyed` | Lifecycle hooks, in that order. `viewWillShow`/`viewDidShow`/`viewWillHide`/`viewDidHide` bracket enter/leave animations. |
| `animations` | A class field `{ in?, out? }` of Web Animations specs (§12). |
| anything else | Your own helpers, called from hooks and handlers. |

Class fields (`events`, `animations`) have no commas between them and other members. A few member names belong to the framework (`render`, `refresh`, `getData`, `setData`, `memo`, `refs`, and names starting `__`); the list is in §4.

### `this.ctx`

Every view and component gets `this.ctx` with three services: `store` (records), `router` (`this.ctx.router.push('/home')`), and `formatters` (the function registry, rarely needed). `i18n` joins them when the app configures translations.

## `data()` and state

`data(params, props)` answers "what does this component need?". It runs:

1. on mount, with route params and props;
2. when a prop changes;
3. when route params change;
4. when a store record it queried changes — any `findOne`/`findMany` inside `data()` subscribes automatically. On a model with an adapter, a query that misses fetches and `data()` re-runs until the data settles (§61), so `data()` can stay synchronous.

```js
// UserProfile.pzl — re-runs whenever the userId prop changes
data(params, props) {
  return { user: this.ctx.store.findOne('user', props.userId) };
}
```

Two layers of state:

- **The model** — each `data()` result **replaces** the last one.
- **Local state** — `this.setData(key, value)` or `this.setData({ … })` writes a layer underneath that survives `data()` re-runs, and re-renders **without** re-running `data()`. When `data()` derives something from local state, call `this.refresh()` after `setData`.

```js
created() {
  this.setData({ filter: 'all' });
}

data() {
  const todos = this.ctx.store.findMany('todo');
  const { filter } = this.getData();
  return {
    todos: filter === 'all' ? todos : todos.filter((t) => t.completed === (filter === 'done')),
    remaining: todos.filter((t) => !t.completed).length,
    filter,
  };
}

events = {
  setFilter: (filter) => {
    this.setData('filter', filter);
    this.refresh();
  },
  addTodo: () => this.ctx.store.createRecord('todo', { text: 'New todo' }), // subscribers re-run
};
```

A template reads only what `data()` returns — it has no `this`, so a helper method or getter on the class is out of its reach. Put the value in the model (a getter on a `PuzzleModel` works as a field: `{ user.fullName }`).

## Skeletons

`<puzzle-skeleton>` is a top-level section, a sibling of `<puzzle-view>`. It renders while the **first** `data()` is pending — an `async data()`, or tracked store reads still fetching (every fetch round counts as one load, §61) — and swaps to the real template when the model commits. A `data()` that resolves at once never shows it, and later refreshes keep the current content on screen.

```html
<puzzle-skeleton min-duration="300">
  <div class="bg-skeleton h-8 w-1/2 animate-pulse"></div>
</puzzle-skeleton>
```

- `min-duration` (ms, static) keeps a skeleton that has appeared on screen at least that long, so fast loads don't flash.
- Only state seeded in `created()` is readable while it shows.
- A routed view with a skeleton commits the navigation immediately and fills in; one without holds the previous page until its data is ready.
- In a component, the skeleton needs a single plain root element; keep its tag equal to the template's root.
- Load errors: return an error model from `data()` and branch in the template, or let the app's `errorView` handle it (§60).

Full rules: [[DOC-SPEC-VIEW]] §16.

## Styles

- `<style>` is global CSS.
- `<style scoped>` confines the rules to this component's rendered subtree using native `@scope`; they still cascade into child components. It's the only attribute `<style>` accepts.

```html
<puzzle-view class="card"><h2>{ title }</h2></puzzle-view>
<style scoped> h2 { color: rebeccapurple; } </style>
```

## Component families

Related components can share one import: a directory of `.pzl` files (one class each) plus an `index.js` barrel —

```js
export default Object.assign(Frame, { Wrapper, Content });
export { Frame, Wrapper, Content };
```

— used as `<Frame><Frame.Wrapper>…</Frame.Wrapper></Frame>`. `puzzle generate component Frame --family Wrapper,Content` scaffolds it (§65).
