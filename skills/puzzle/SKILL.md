---
name: puzzle
description: >
  Triggers on any work building or editing a Puzzle framework app: .pzl files,
  "puzzle view", "puzzle component", "PuzzleApp", "puzzle routes", "puzzle build",
  "puzzle dev", SSG/static export of a Puzzle app, or work in a repo containing
  puzzle.config.js. Covers app structure, .pzl anatomy, events, routing, the data
  layer, testing and fixtures, loading skeletons, morph transitions, static
  prerendering rules, and puzzle-pieces conventions.
version: 1.3.0
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
├── puzzle.config.js       # { styles: { use: ['tailwindcss'] }, output: 'static' | 'hybrid' }
└── app/
    ├── app.js             # new PuzzleApp({ target: '#app', routes, models, formatters }); MUST `export default app` for prerender modes
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
`--hybrid`, `--mode production|development`), `preview` (serve an existing
`dist/` with production-host semantics), `init`, `generate`, `add` (tailwind integration,
`piece <name…>`, `skills`), `upgrade`, `doctor`, `info`.

- `dev` and `build` both take `--fixtures` (see Fixtures below).
- `dev` and `build` both take `--profile-build` (or `PUZZLE_PROFILE_BUILD=1`):
  per-phase timing tables on stderr — check it before guessing why a build or
  save feels slow.
- A busy `--port` is not fatal: `dev` scans upward for the first free one and
  warns when it moved. `--strict-port` restores bind-or-fail.
- `puzzle upgrade skills` refreshes the installed agent skill from the running
  binary. `puzzle upgrade` also offers the refresh after it installs a new
  version. Re-running `puzzle add skills` asks before replacing an existing
  install rather than erroring.

Production builds default to ES2022, minification, and **console stripping** —
set `build: { dropConsole: false }` in puzzle.config.js to keep console calls.
Linked source maps are **opt-in** in production (`build: { sourceMap: true }`);
dev always emits them. Note that a JSON `null` means "unset" for these keys, not
`false`.

**Code splitting.** By default the SPA build emits ONE `dist/app.js` and a
dynamic `import()` is inlined into it — a heavy on-demand dependency (mermaid, a
chart library, an editor) is paid for on every page load. Set
`build: { splitting: true }` and each dynamic `import()` becomes a lazy chunk
under `dist/chunks/`, fetched by the browser only when that code path runs.
The entry keeps its stable `app.js` name, so the shell HTML is unchanged, and
esbuild's ESM splitting has no chunk-loader runtime, so total bytes do not grow.
Static imports are untouched — an app with no dynamic `import()` builds to the
same single file as before. Notes:

- **`chunks/` becomes a reserved output name** while the flag is on: a
  root-level `public/chunks` asset fails the build (as `app.js` already does).
- `output: 'static'` ignores the flag — those pages get their own already-split
  per-page bundles and no `app.js` ships. `hybrid` splits like the SPA.
- The build's size banner prints a **largest-dependencies** breakdown from
  esbuild's metafile and, in production, flags any single dependency over
  200 KB — the signal to move it behind a dynamic `import()`. Your own code and
  the framework itself are listed but never flagged.
- With splitting on, vendoring a chunked ESM build as a static asset (loading it
  through a variable URL so esbuild leaves it alone) is no longer necessary —
  write a plain `await import('pkg')` instead.

**Dev API proxy.** `dev: { proxy: { '/api': 'http://localhost:3091' } }` forwards
matching prefixes to a backend so the app can use same-origin paths
(`apiURL: ''`) with no CORS middleware. Paths are forwarded unrewritten. A `/`
prefix and two prefixes differing only by a trailing slash are both config
errors — proxy a specific prefix.

## .pzl anatomy

Template markup + `<script>` (+ optional `<style>`, `scoped` supported):

```html
<puzzle-view>
  <button class={ classes } @click={ increment }>{ count | number }</button>
</puzzle-view>

<script>
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
</script>
```

Template syntax: `{ expr | formatter }` (formatters are registered display
helpers — the project term is *formatter*, never *filter*),
`{#if}/{:else if}/{:else}/{/if}`, `{#unless}`, `{#for item in items, i}`
(trailing `, name` binds the index), `{#case}/{:when}`, `{#raw}…{/raw}` (brace
grammar off inside — literal braces compile as-is, HTML still parses; no
nesting, and attribute-value use is a compile error),
`@event={ handler }` with modifiers, component imports used as capitalized tags.
`<script lang="ts">` for TypeScript (transpile-only — types stripped, never
checked, at compile).

Rules that bite:

- **Text is text.** Template text is NOT HTML-entity decoded and interpolations
  become text nodes — you cannot inject markup through `{ expr }`. The one
  raw-markup exception is compile-time `{#svg 'path.svg'}` inline SVG.
  `{#raw}` is not a second one — it only turns the brace lexer off; no runtime
  value can reach inside it.
- **Two marker tags, three meanings.** `<Children/>` marks where a component's
  default children render; `<Slot name="x"/>` declares a named region (the
  caller routes a direct child in with a static `slot="x"` attribute);
  `<Slot/>` is the ROUTER outlet where a child route or routed view renders.
  A marker is self-closing, or paired with a fallback body that renders only
  when nothing fills it (`<Slot name="trigger"><b>Open</b></Slot>`) — supplied
  content replaces the fallback entirely. Lowercase `<children>`/`<slot>` are
  compile errors.
- **`<Portal>` teleports overlays.** `<Portal>…</Portal>` (paired-only,
  attribute-free) mounts its children into a framework-created outlet beside
  the app root while staying in the owner's component tree — for modals and
  full-screen panels that must escape ancestor CSS. `@event:outside` treats
  portaled content as inside its logical owner. Portals emit nothing in
  prerendered HTML (content appears at takeover). For focus-trapped modals,
  prefer native `<dialog>.showModal()` via a ref. A `<Portal>` cannot be a
  COMPONENT's template root (the root receives call-site attrs and the scoped
  style stamp) — wrap it: `<div style="display: contents"><Portal>…</Portal></div>`.
  A portal-only view is fine.
- **Error handling.** `new PuzzleApp({ onError(error, { phase, view, route }) })`
  hears every framework-contained failure (mount, refresh, navigation);
  `errorView: AppErrorView` (an ordinary compiled `.pzl` view) is the app-wide
  fallback — a failed view/component is replaced in place by a fresh error-view
  instance (parent and siblings survive) with `{ error, info, retry }` props;
  `retry()` uses a full same-location navigation for routed failures or the
  parent's normal refresh for component failures, never automatically. There
  is no per-view error member — write error UI as normal template markup, never
  as hand-built ViewNodes. Event handlers and formatters stay uncaught.
- **`island` freezes children.** An element with the `island` attribute keeps
  its children untouched by patching after mount (for third-party DOM widgets);
  the element's own attrs/listeners still patch. Components, slots, and view
  roots cannot be islands.
- **`flip` animates keyed reorders** (puzzle ≥ 0.2.0). On a keyed `{#for}` row
  root, `flip` (bare) makes retained rows SLIDE to their new position when the
  list is sorted/filtered/reordered — inserts and removes keep their normal
  enter/leave animations. Options via an object from `data()`:
  `flip={ flipOpts }` with `flipOpts: { duration: 400, easing: '...' }`
  (inline object literals are not valid template expressions). Respects
  reduced motion; never write `flip` on an unkeyed row.

## Events

- On DOM elements, `@click={ handler }` attaches a real, patch-managed listener.
  Modifiers stack: `@click:prevent:stop`, `@keydown:enter`, `@click:once`.
- **Outside-dismiss is one modifier** (puzzle ≥ 0.2.0): `@pointerdown:outside={ close }`
  fires only when the event lands OUTSIDE the bound element. Put it on the
  panel root inside `{#if open}` (listener lifetime tracks the panel), or on
  an always-mounted root as `@pointerdown:outside={ open ? close : null }`.
  The listener lives on `document` (capture phase) and Puzzle removes it on
  unmount — never hand-roll `document.addEventListener` for dismissal again.
  Works on any event: `@click:outside`, `@focusin:outside` (focus left the
  widget).
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

## Two-way form binding (puzzle ≥ 0.5.0)

Form controls bind themselves — write NO input handler:

```html
<input value={ draft } />                             <!-- local state -->
<input type="checkbox" checked={ todo.completed } />  <!-- record field -->
<input type="number" value={ profile.hue } />         <!-- commits on change -->
```

- Binds when the expression is exactly `ident` or `ident.ident` on a plain
  `<input>`/`<textarea>`/`<select>` with no author `@input`/`@change`, no
  static `readonly`/`disabled`, and an absent or static classifiable `type`.
  Never on components (their `value` is a plain prop). Excluded: radio, file,
  `<select multiple>`, dynamic `type={ }`, `value` on a checkbox.
- Text-ish inputs, textarea, and range update on `input`; number, checkbox,
  date kinds, and select commit on `change`. Numeric edges: `''` writes
  `null` (never `0`), NaN is skipped. Mid-IME-composition events never write.
- **Bind the path you want written.** A member path (`profile.name`) writes
  the record through validated `update()` — a rejected write reports to
  `onError` with `phase: 'bind'` and leaves the typed text on screen. A bare
  key (`draft`) writes local state AND re-runs `data()`, so derived values
  (a filtered list, a disabled submit) stay live as you type. Do NOT bind a
  local key that `data()` derives from a record — the next commit reverts it
  (dev warns once per key).
- Constrained fields (`required()`, `min(3)`): bind a local draft, commit
  with `record.update()` on submit, pre-check with the non-throwing
  `validate()` — a bind can never clear a `required()` field.
- Opting out needs no syntax: write your own `@input`/`@change` (the author
  handler owns the write — nothing is synthesized), use a non-path expression
  (`value={ String(x) }`), or add static `readonly`. Migration gotcha: a
  handler-less `value={ x }` that a `@keydown:enter` handler used to commit
  is now live-bound — escape with `String(x)` when you need edit-buffer
  semantics (Enter-commit / Escape-cancel).
- In tests, `await handle.type('input.search', 'hello')` (from
  `@magic-spells/puzzle/testing`) drives a bound control and settles.

## Routing

`app/routes.js` exports an array of `{ path, name, view, layout, guard, meta, children }`.

- **Router mode** (puzzle ≥ 0.6.0): path routing is the default — omit
  `routerMode` entirely. Hash and memory routing are imported factories:
  `import { hashRouter, memoryRouter } from '@magic-spells/puzzle/router-modes'`,
  then `routerMode: hashRouter()` or `memoryRouter({ initialPath: '/' })`. The
  strings `'hash'`/`'memory'` throw at construction (the error names the
  import) — path-mode apps ship none of the other modes' code.
- Nested routes: `children` with **relative** paths render at the parent view's
  `<Slot/>`; `layout` is top-level-only; params merge down the chain.
- **Route guards** (puzzle ≥ 0.2.0): `guard: ({ to, from, ctx }) => verdict` on
  any route covers that node AND all its children — guard the top-level route
  once to lock the whole layout subtree; a child may add its own stricter
  guard (they run root→leaf, first failure wins). Verdicts: `undefined`/`true`
  allow; `false` blocks (stay put, nothing commits); a path string redirects
  via `replace()` semantics (denied URL never enters history). Guards run
  before views construct or `data()` runs, on every navigation including
  params-only and nav #0 (`from === null` there); async guards are awaited.
  Restore sessions in the app-config `beforeMount(app)` hook (awaited before
  nav #0) so guards stay synchronous store reads. Redirect-after-login idiom:
  guard returns `'/login?redirect=' + encodeURIComponent(to.path)`; the login
  view reads `this.route.query.redirect` and `router.replace()`s it. Guards
  are UX, not security — the server must authorize independently; prerendered
  (hybrid) pages with guards warn at build (markup ships publicly; set
  `prerender: false`), and static output warns too (no router — guards never
  run there).
- `:param` and `*` supported; `*` catch-all must stay **last** (routes match in
  order). Route views/layouts must be **statically imported** in routes.js.
- **Head metadata lives on `meta`** (puzzle ≥ 0.2.0): `title`, `description`,
  `canonical`, `socialImage` — static strings, each inherited leaf→root
  independently (`null` suppresses an inherited value). Define root-route
  defaults so child routes never show stale values. Values are static only — no
  functions or per-record titles. **Delivery is split, and this trips people
  up:** the browser syncs `document.title` on every navigation, but the
  og/twitter/canonical tags are baked per page **at build time only** and are
  never touched at runtime. Crawlers and unfurlers GET each URL fresh and never
  client-navigate, so they always read the correct baked copy. The consequence:
  in the default SPA build (no `output` key — the only valid values are
  `'static'` and `'hybrid'`, so no prerender pass runs)
  `description`/`canonical`/`socialImage` are accepted but **inert** — if you
  need social previews, build
  `hybrid` or `static`. Do not write code that reads an og tag out of the live
  DOM after an in-app navigation; it will be navigation zero's value.
- **Focus + route announcement are automatic** (puzzle ≥ 0.2.0): every committed
  navigation moves focus to the incoming view root (with `preventScroll`, under
  a transient `tabindex="-1"` that also suppresses `outline`/`box-shadow` for
  its lifetime — no focus ring around the view) and announces the committed
  title in a
  framework-owned visually-hidden `aria-live` region. You get accessible SPA
  navigation for free — don't hand-roll it. `focusBehavior` mirrors
  `scrollBehavior`: omit for the default, `false` to disable entirely
  (announcement included), or a function to take over. Memory mode and
  navigation #0 are no-ops; static output has no router, so it gets neither.
- **Query state is on the route snapshot** (puzzle ≥ 0.2.0): `this.route.query`
  is a parsed, frozen object (`?q=x&tag=a&tag=b` → `{ q: 'x', tag: ['a','b'] }`);
  `this.route.pathname`/`hash` split the raw `path`. Query never merges into
  params. For transient URL state (filters, search, tabs) update with
  `this.ctx.router.replace('/list?q=' + encodeURIComponent(v))` — same
  pipeline as `push()` but NO new history entry and scroll stays put; a
  query-only change re-runs `data()` with the new snapshot.
- Navigation loads before commit: URL, title/head, history, mounted tree, and
  scroll save land atomically together — a failed or superseded navigation
  commits nothing.
- Write template hrefs **path-shaped through the built-in `link` formatter**:
  `href="{ '/todos/' + t.id | link }"`. It emits the mode-appropriate href
  (plain path in path mode, base-prefixed under `routerBase`, `#/...` in
  hash mode); strings not starting with `/` pass through (external URLs,
  `mailto:`, `#anchor`). Hand-written `#/...` hrefs still work in hash mode,
  but piped links are the portable spelling.

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
  // static adapter = { endpoint: '/api/todos' }; // generates the five REST transports
}
```

Enable server sync once through `app/adapter.js`; model files need no adapter import:

```js
// app/adapter.js — bare REST capability
import { adapter } from '@magic-spells/puzzle/adapter';
export default adapter;

// app/app.js
import adapter from './adapter.js';
const app = new PuzzleApp({ target: '#app', routes, models, adapter });
```

For an app-wide API dialect, export `adapter.defaults({ ...verbs })` instead.
The transport ladder, most-specific first, is: model function → app default →
endpoint-generated REST. App defaults use the same five verbs but receive a
trailing `{ type, endpoint }` argument after the normal verb arguments;
`endpoint` is undefined for a model without one. A model function always wins
and keeps its existing signature unchanged:

```js
// app/adapter.js — unwrap the same envelope for every model
import { adapter } from '@magic-spells/puzzle/adapter';

export default adapter.defaults({
  async loadAll(fetch, options, { endpoint }) {
    const response = await fetch(endpoint);
    return (await response.json()).data;
  },
});
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
- Server (needs a `static adapter` plus the `/adapter` capability passed once
  to `PuzzleApp`): `loadOne`/`loadAll` (identity-preserving upsert),
  `record.save()`, and `record.delete()`. `{ endpoint: '/api/todos' }` is the
  REST shorthand: it generates GET/POST/PUT/DELETE transports. Override only
  the verbs your API changes, or omit `endpoint` for a fully custom adapter.
  `store.request()` remains the endpoint-prefixed JSON escape hatch.
- Records mutate in place: `record.update(patch)`, `record.destroy()`,
  `record.validate()` → `{ valid, errors }` (non-throwing, for form UX).

Adapter functions receive an enhanced `fetch` as their first argument. It has
the standard fetch signature and returns a standard `Response`, but also runs
`beforeRequest` and routes through the fixtures mock seam. Puzzle owns response
validation and reconciliation after a framework verb returns:

```js
// REST shorthand
static adapter = { endpoint: '/api/posts' };

// Different URL, standard payload: Puzzle checks/parses the Response.
static adapter = { loadAll: (fetch) => fetch('/v2/posts') };

// Envelope + custom method
static adapter = {
  async loadAll(fetch, options) {
    const query = new URLSearchParams(options);
    return (await (await fetch(`/v2/posts?${query}`)).json()).data;
  },
  async publish(fetch, id) {
    return (await fetch(`/v2/posts/${id}/publish`, { method: 'PATCH' })).json();
  },
};

await store.loadAll('post', { page: 1 });
await store.loadAll('post', { page: 2 }); // pages accumulate; existing ids merge
const post = store.upsert('post', await store.adapter('post').publish(id));
```

Using global `fetch` instead of the supplied parameter is legal and literal:
it bypasses both `beforeRequest` and fixtures interception.

**Record identity ignores number/string spelling.** `findOne('todo', id)` returns
the same record whether `id` is `7` or `'7'` — which matters constantly, because
route params are always strings while JSON payloads usually carry numbers. FK
comparison in `belongsTo`/`hasMany` uses the same rule. Only numbers normalize:
`null`/objects keep strict identity, and there is no numeric parsing (`'01'` ≠
`1`). A record's own key field keeps its original type. So
`findOne('post', this.route.params.id)` is correct as written — do not add
`Number(...)` coercion.

**Auth headers: `beforeRequest`.** Generated transports, supplied-fetch calls,
and `store.request()` funnel through one hook you set in the app config:

```js
new PuzzleApp({
	adapter,
	beforeRequest(init, { type, method, url }) {
    init.headers = { ...init.headers, Authorization: `Bearer ${token()}` };
  },
});
```

It is **synchronous by design**, so inline token refresh is not supported —
refresh outside the request path and let the hook read the current token. Mutate
`init` or return a new one.

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

## Testing (`@magic-spells/puzzle/testing`)

Puzzle ships its own test utilities — do NOT hand-roll a harness, and do not
reach into private fields to await renders.

```js
import { mountView, createTestApp, settled } from '@magic-spells/puzzle/testing';

const view = await mountView(TodoItem, { props: { id: '1' }, models: { todo: Todo } });
await view.click('button.toggle');       // dispatches, then awaits settled()
expect(view.find('.title').textContent).toBe('Walk the dog');
view.destroy();                          // always, to release subscriptions

const app = await createTestApp({ routes, models });   // real app, memory router
await app.router.push('/todos/1');
```

- `mountView(ViewClass, options)` mounts ONE view against a detached container.
  Options: `params`, `props`, `children`, `ref`, `route`, `models`, `store`,
  `router`, `formatters`, `adapter`, `ctx`. Returns a handle: `instance`, `container`,
  `element`, `ctx`, `store`, `router`, `find(sel)`, `findAll(sel)`,
  `click(target)`, `setProps(props)`, `destroy()`.
- `createTestApp(config)` boots a REAL `PuzzleApp` — `target` and memory
  routing are forced (`routerInitialPath` seeds it), everything else passes
  through. Handle: `app`, `store`, `router`, `ctx`,
  `find`, `findAll`, `click`, `destroy()`.
- `settled()` awaits the framework's pending render/flush work. `click()` and
  `setProps()` already await it; use it directly after mutating the store.
- `installFakeAnimate()` / `installFakeObserver()` stub Web Animations and
  IntersectionObserver so animation and `trigger: 'visible'` code paths run
  deterministically under jsdom.

## Fixtures and the mock adapter

Schema-driven fake data, generated from the model `static schema` alone:

```js
// app/fixtures.js
export default {
  seed: { todo: 12 },                       // generate 12 todos from the schema
  mock: { todo: { latency: 150 } },         // intercept adapter calls for this type
  setup(store) { /* optional hand-tuning after seeding */ },
};
```

Run with `puzzle dev --fixtures` or `puzzle build --fixtures`. **Without the
flag nothing imports the module**, so fixtures can never reach a production
bundle — that exclusion is structural, not a tree-shaking heuristic. In tests,
call `installFixtures(config)` (re-exported from `/testing`) yourself.

The mock adapter replaces the store's single network seam, so it behaves
identically in `puzzle dev` and in Vitest — this is deliberately a client-side
mock, not a dev-only mock server.

## DevTools

A Chrome DevTools extension (separate repo, `magic-spells/puzzle-devtools`)
inspects views, store records, and the subscription graph. The framework ships
only a dev-only bridge that activates when the extension is installed; it costs
**zero production bytes** and needs no config. Nothing to wire up — but if you
are debugging reactivity, `window.__PUZZLE_APP__` is also available in dev
builds.

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

## Prerendered output — THE RULES (bugs happen when these are missed)

Two output modes, chosen in puzzle.config.js or by flag. Both emit
`dist/<path>/index.html` per static route + `styles.css`; top-level `*` renders
to `dist/404.html`; the route's `meta.title` is injected via a leaf→root walk.

- **`output: 'static'`** / `puzzle build --static` — a TRUE static site. No
  router, no SPA, no `app.js` in `dist/`. Each page ships a small module
  (`/_puzzle/<slug>.js`) that mounts only that page's components over the
  prerendered markup, so `@event` handlers and local state work; navigation is
  plain `<a href="/path/">` page loads. Pick this for docs/marketing/blogs.
- **`output: 'hybrid'`** / `puzzle build --hybrid` — prerendered first paint,
  then the full SPA bundle takes over on load and re-renders (not true
  DOM-adoption hydration); all later navigation is client-side (transitions,
  morphs work). Pick this for apps that want SEO'd entry pages.

`puzzle dev` on a static-mode project serves the REAL static output (clean
URLs, full page loads, real 404s, prerender on every rebuild); hybrid projects
dev as the SPA. `puzzle preview` serves an existing `dist/` with
production-host semantics for any mode (SPA deep-link fallback, static real
404s) — use `puzzle build && puzzle preview` to check the shipped artifact.

1. **`data()` and `beforeMount` run under Node at build time** (both modes).
   Guard every browser global: `typeof document !== 'undefined'` before touching
   `document`, `window`, `localStorage`, `matchMedia`. DOM behavior belongs in
   `mounted()`.
2. **In static mode `beforeMount` NEVER runs in the browser.** Its store seeds
   (CMS fetches etc.) are serialized into an inline JSON island per page and
   rehydrated before mount — so build-time credentials stay build-side, and
   browser-only setup must not live in `beforeMount`.
3. **`:param` routes are SKIPPED by the prerenderer** (no `staticPaths()` hook
   yet) — a warning is printed and no file is written. For content sites, every
   page must be an explicit static route. Treat any "skipped" in the build
   summary as a regression.
4. **Inline `<script>` inside route markup is dead in both modes** — the mount
   over the prerendered markup discards it. Only the shell
   (`app/public/index.html`) may carry inline scripts (analytics, theme
   pre-paint). All other behavior: `mounted()` / cleanup in `destroyed()`.
5. **Static mode has no router and emits only plain path hrefs.** Hash-style
   `#/...` links are an SPA/hybrid concern (`routerMode: hashRouter()`) with no
   meaning on a static site — never hand-write them in templates that build
   statically; path-shaped `| link` hrefs render as plain paths in static
   output and as `#/...` in a hash-mode SPA, from the same template.
   `ctx.router` methods throw; `push()` calls
   are a bug — use plain links. Custom formatters must be exported from
   `app/formatters.js` to exist client-side (formatters only in the app.js
   config trigger a build warning); models are picked up from
   `app/models/index.js`. The `link` formatter is absent client-side in static
   output — its pass-through fallback still yields correct plain-path hrefs.
   A configured adapter (`adapter.defaults(...)`) is best exported from
   `app/adapter.js` and passed to the app from there: each static page then
   imports just that module. Configuring it inline in `app.js` still builds
   and behaves identically — the build falls back to importing the app entry
   from every page to reach the exact configured value (an advisory notes the
   page-weight cost). A bare `adapter` needs no file either way.
6. `prerender: false` on a route emits an empty shell (invisible to any static
   search indexer): in hybrid it's an SPA island; in static it still gets its
   per-page module and renders fully client-side. Escape hatch for
   interactive-only pages.
7. Prerendered output pairs with post-build tooling: Pagefind can index `dist/`
   (content is baked into `#app`). Since puzzle 0.2.0 the build writes
   `<title>` PLUS og/twitter/canonical tags from the route `meta` head fields
   (see Routing) — and the build is the ONLY place those tags are ever written,
   so prerendering is what makes them exist at all. Sitemap generation still
   needs your own Node script.

## Styling

Tailwind v4 is the supported pipeline (`styles: { use: ['tailwindcss'] }` — the
CLI folds Tailwind output + collected `<style>` blocks into `dist/styles.css`;
wire it with `puzzle add tailwind`). For puzzle-pieces apps, merge the registry's
`theme/pieces.css` after `@import "tailwindcss"` and style ONLY via its semantic
tokens (`bg-surface`, `text-ink`, `bg-brand`, `border-border`…); dark mode is
`light-dark()` CSS driven by `data-theme` on `<html>` (set it pre-paint in the
shell).

## puzzle-pieces (component library)

Copy-in registry, shadcn-style: the files land in your app; nothing imports
the registry package at runtime. Use `puzzle add piece <name…>` (copies each
piece + its transitive piece/lib dependencies verbatim, records hashes in
`pieces.lock`; `--overwrite` to refresh; required npm packages and the theme
merge are printed as next steps). The default source is the
`@magic-spells/puzzle-pieces` npm package, version-locked to the CLI's
major.minor (falls back to the newest OLDER release with a printed note).
`--pieces-version` pins a release; `--registry` (or `$PUZZLE_PIECES_REGISTRY`)
takes `npm:<package>[@version]`, a local directory, or an http(s) URL. Once
copied, a piece is YOUR code: import it like any component (`import Button
from '../components/ui/Button.pzl'`) and use it as a capitalized tag. Pieces
follow a `BASE` + `VARIANT`/`SIZE` class-map convention with a
`class` prop for caller overrides. Audit copied pieces for SSG rule #1 above
before prerendering them.
