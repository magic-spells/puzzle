---
name: puzzle
description: >
  Triggers on any work building or editing a Puzzle framework app: .pzl files,
  "puzzle view", "puzzle component", "PuzzleApp", "puzzle routes", "puzzle build",
  "puzzle dev", SSG/static export of a Puzzle app, or work in a repo containing
  puzzle.config.js. Covers app structure, .pzl anatomy, events, routing, the data
  layer, loading skeletons, morph transitions, static prerendering rules, and
  puzzle-pieces conventions.
version: 1.1.0
---

# Puzzle Framework — App-Builder Guide

Puzzle is Magic Spells' SPA framework: single-file `.pzl` components compiled by
a Go + esbuild toolchain, with an optional static-prerender (SSG) mode. Puzzle is
NEW — assume you have no training data about it; this skill is the source of
truth, and Puzzle is not React/Vue/Svelte (no hooks, no `$emit`, no SFC
`<template>` conventions). When you need more than this file covers, learn from
the working example apps in `examples/` at https://github.com/magic-spells/puzzle
(`examples/todos` is the canonical app).

## App skeleton

```
my-app/
├── puzzle.config.js       # { styles: { use: ['tailwindcss'] }, output: 'static' }
└── app/
    ├── app.js             # new PuzzleApp({ target: '#app', routes, models, formatters }); MUST `export default app` for SSG
    ├── routes.js          # route table (see below)
    ├── public/index.html  # the shell: #app mount + <script type="module" src="/app.js">
    ├── styles/styles.css  # global entry; Tailwind v4 via the config's styles pipeline
    ├── layouts/*.pzl      # chrome with <Slot/>
    ├── views/*.pzl        # pages
    ├── components/*.pzl
    └── models/*.js
```

CLI (bin `puzzle`, installed with `@magic-spells/puzzle`):
`dev` (SSE live reload, state-preserving full-page refresh), `build` (`--static`,
`--mode production|development`), `init`, `generate`, `add` (tailwind integration,
`piece <name…>`, `skills`), `upgrade`, `doctor`, `info`.

Production builds default to ES2022, minification, and **console stripping** —
set `build: { dropConsole: false }` in puzzle.config.js to keep console calls.

## .pzl anatomy

Template markup + `<scripts>` (+ optional `<styles>`, `scoped` supported):

```html
<puzzle-view>
  <button class={ classes } @click={ increment }>{ count | number }</button>
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
export default class Counter extends PuzzleView {
  data() { return { count: this.getData()?.count ?? 0 }; }  // runs at render — and under NODE during prerender
  events = {
    increment: () => this.setData('count', this.getData().count + 1),
  };  // handlers MUST be arrow functions in the `events` class field —
      // method shorthand is a compile error (`this` would break at fire time)
  mounted() { /* browser-only setup: listeners, intervals, DOM */ }
  destroyed() { /* MANDATORY cleanup of window listeners/intervals */ }
}
</scripts>
```

Template syntax: `{ expr | formatter }` (formatters are registered display
helpers — the project term is *formatter*, never *filter*),
`{#if}/{:else if}/{:else}/{/if}`, `{#unless}`, `{#for item in items, i}`
(trailing `, name` binds the index), `{#case}/{:when}`, `@event={ handler }`
with modifiers, component imports used as capitalized tags.
`<scripts lang="ts">` for TypeScript (transpile-only — types stripped, never
checked, at compile).

Rules that bite:

- **Text is text.** Template text is NOT HTML-entity decoded and interpolations
  become text nodes — you cannot inject markup through `{ expr }`. The one
  raw-markup exception is compile-time `{#svg 'path.svg'}` inline SVG.
- **Three slot-like things, three meanings.** `<children/>` marks where a
  component's default children render; `<slot name="x">fallback</slot>` declares
  a named region (the caller routes a direct child in with a static
  `slot="x"` attribute); `<Slot/>` is the ROUTER outlet where a child route or
  routed view renders. Bare lowercase `<slot/>` is a compile error.
- **`island` freezes children.** An element with the `island` attribute keeps
  its children untouched by patching after mount (for third-party DOM widgets);
  the element's own attrs/listeners still patch. Components, slots, and view
  roots cannot be islands.

## Events

- On DOM elements, `@click={ handler }` attaches a real, patch-managed listener.
  Modifiers stack: `@click:prevent:stop`, `@keydown:enter`, `@click:once`.
- On COMPONENT tags, `@save={ savePost }` is NOT a DOM event — it's a **callback
  prop**. The child invokes it as `this.props.save(...)`. There is no `$emit`
  and no event bubbling between components; child→parent communication is
  callback props. Modifiers are compile errors on component callback props.
- `ref="name"` on a plain element in your OWN template gives `this.refs.name`
  (live node, populated before `mounted()`). `ref` is NOT allowed on component
  tags — when a parent needs a child's imperative handle (a carousel's
  `.next()`), the child delivers it up once via an `@ready` callback prop; store
  it on an instance field (not `setData`) and guard every use with `?.`.
- If a callback prop is wired into a long-lived external system, read it at fire
  time (`(e) => this.props.name?.(e)`), never capture it at wiring time.

## Routing

`app/routes.js` exports an array of `{ path, name, view, layout, meta: { title }, children }`.

- Nested routes: `children` with **relative** paths render at the parent view's
  `<Slot/>`; `layout` is top-level-only; params merge down the chain.
- `:param` and `*` supported; `*` catch-all must stay **last** (routes match in
  order). Route views/layouts must be **statically imported** in routes.js.
- Navigation loads before commit: URL, title, history, mounted tree, and scroll
  save land atomically together — a failed or superseded navigation commits
  nothing.

## Data layer

Models live in `app/models/`, extend `PuzzleModel`, and declare a `static
schema` with `Puzzle` builders (the only documented way to define fields):

```js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Todo extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
  };
  // static adapter = { endpoint: '/api/todos' };  // enables loadOne/loadAll/save/delete
}
```

Builders: `string() number() boolean() date() array() object()`, plus
`belongsTo(type)` / `hasMany(type)` relationships (lazy getters backed by the
store). Chainable modifiers: `.primary() .required() .default() .min() .max()
.oneOf([...]) .validate(fn)`. **Always use the function form of `.default()` for
arrays/objects** (`.default(() => [])`) so records don't share one instance.
Register model classes in the app's `models` config.

Views reach the store as `this.ctx.store`:

- Local: `createRecord(type, data)` (validates, defaults, notifies),
  `findOne(type, id)`, `findMany(type, { filter }?)`.
- Server (needs `static adapter`): `loadOne`/`loadAll` (GET + identity-preserving
  upsert), `record.save()` (POST new / PUT synced), `record.delete()`,
  `store.request()` for custom endpoints — apply returned records with
  `store.upsert(type, payload)`, don't re-fetch.
- Records mutate in place: `record.update(patch)`, `record.destroy()`,
  `record.validate()` → `{ valid, errors }` (non-throwing, for form UX).

The reactivity contract — the three methods are not interchangeable:

- **`data()`** owns the model layer. Store queries made inside `data()`
  **auto-subscribe** the view; when matching records change, `data()` re-runs
  and the result replaces the view's data wholesale (replace-on-commit).
- **`setData(patch)`** owns persistent local UI state (open panels, drafts).
  It rerenders WITHOUT re-running `data()` and survives it.
- **`refresh()`** re-runs `data()` — use it when local state feeds
  `data()`-derived values.
- **Record props carry identity, not liveness.** Records mutate in place, so a
  child receiving a record prop won't re-render on that record's internal
  changes. Pass the id and re-query inside the child's own `data()` for a live
  subscription.

Persistence: give the app config a `storage` (e.g. localStorage-backed); the
store hydrates at startup and persists snapshots after changes, fail-soft.

## Loading skeletons

`<puzzle-skeleton>` is an optional TOP-LEVEL section of a `.pzl` file — a
sibling of `<puzzle-view>`, not a tag inside it. Its content renders while the
component's **first `data()`** is pending (async data), then swaps for the real
template. No loading flag, no API — declare it and Puzzle handles timing.

```html
<puzzle-view>…real template…</puzzle-view>

<puzzle-skeleton min-duration="300">
  <div class="animate-pulse h-24 rounded bg-surface"></div>
</puzzle-skeleton>
```

At most one per file. Its only legal attribute is `min-duration` (ms,
anti-flash hold — static number only); anything else is a compile error.

## Morph transitions (optional)

Shared-element route transitions ("the card grows into the detail page"),
powered by the optional `@magic-spells/morph-engine` peer dependency. Apps that
never import the subpath bundle none of it.

```js
// npm install @magic-spells/morph-engine
import { enableMorph } from '@magic-spells/puzzle/morph';
const app = new PuzzleApp({ ... });
enableMorph(app);   // once, after construction; before or after mount()
```

Usage: mark two elements with the same `data-puzzle-morph="some-id"` and the
router morphs between them across a navigation — in BOTH directions, including
the browser back button. Both route shapes are handled automatically: a
nested-route dialog whose source card stays mounted (live pairing), and a full
sibling view swap where the source is destroyed before the target mounts (the
runtime snapshots the outgoing element and flies a clone). No options needed.

Directional variants share the same id namespace, one attribute per element:

- `data-puzzle-morph="id"` — launches AND receives (symmetric pairs, dialogs).
- `data-puzzle-morph-trigger="id"` — launches only, never a landing.
- `data-puzzle-morph-target="id"` — receives only; preferred over a plain
  same-id element when both could land.

Rules that bite:

- Don't position a morph element with `transform` and don't set stylesheet
  `opacity` on a target — the engine drives inline transform/opacity during the
  flight. Center with flex or `inset: 0; margin: auto`.
- No CHANGING dynamic `style={}` binding on either element — the patcher
  rewrites the whole style attribute and clobbers the engine's frames.
- The initial page load never morphs (deep links render plainly), and
  `prefers-reduced-motion` disables morphing entirely — both by design.

Working example: `examples/kanban-morph` in the framework repo.

## SSG / static export — THE RULES (bugs happen when these are missed)

Enable with `output: 'static'` in puzzle.config.js (or `puzzle build --static`).
Emits `dist/<path>/index.html` per static route + shared `app.js`/`styles.css`;
top-level `*` renders to `dist/404.html`. The route's `meta.title` is injected
via a leaf→root walk. Then the SPA **takes over on load and re-renders** (not
true DOM-adoption hydration).

1. **`data()` and `beforeMount` run under Node at build time.** Guard every
   browser global: `typeof document !== 'undefined'` before touching `document`,
   `window`, `localStorage`, `matchMedia`. DOM behavior belongs in `mounted()`.
2. **`:param` routes are SKIPPED by the prerenderer** (no `staticPaths()` hook
   yet) — a warning is printed and no file is written. For content sites, every
   page must be an explicit static route. Treat any "skipped" in the build
   summary as a regression.
3. **Inline `<script>` inside route markup is dead** — the takeover re-render
   discards it. Only the shell (`app/public/index.html`) may carry inline
   scripts (analytics, theme pre-paint). All other behavior: `mounted()` /
   cleanup in `destroyed()` (components DO unmount on SPA navigation — leaked
   window listeners are a real bug).
4. `prerender: false` on a route = SPA island: emits the empty shell (invisible
   to any static search indexer). Escape hatch for interactive-only pages.
5. SSG output pairs with post-build tooling: Pagefind can index `dist/` (content
   is baked into `#app`); sitemap/meta-OG injection needs your own Node script —
   SSG only writes `<title>`.

## Styling

Tailwind v4 is the supported pipeline (`styles: { use: ['tailwindcss'] }` — the
CLI folds Tailwind output + collected `<styles>` blocks into `dist/styles.css`;
wire it with `puzzle add tailwind`). For puzzle-pieces apps, merge the registry's
`theme/pieces.css` after `@import "tailwindcss"` and style ONLY via its semantic
tokens (`bg-surface`, `text-ink`, `bg-brand`, `border-border`…); dark mode is
`light-dark()` CSS driven by `data-theme` on `<html>` (set it pre-paint in the
shell).

## puzzle-pieces (component library)

Copy-in registry, shadcn-style — NOT an npm import. Use `puzzle add piece
<name…>` (copies each piece + its transitive piece/lib dependencies into the app
verbatim, records hashes in `pieces.lock`; `--registry` overrides the source,
`--overwrite` to refresh; required npm packages and the theme merge are printed
as next steps). Once copied, a piece is YOUR code: import it like any component
(`import Button from '../components/ui/Button.pzl'`) and use it as a capitalized
tag. Pieces follow a `BASE` + `VARIANT`/`SIZE` class-map convention with a
`class` prop for caller overrides. Audit copied pieces for SSG rule #1 above
before prerendering them.
