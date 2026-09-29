# Puzzle

Puzzle is an SPA-first JavaScript framework. You write single-file `.pzl`
components: a template, a `<script>`, and optional styles. A view gets its data
from a `data()` method, and a built-in store re-renders it when the records it
read change. The router, the store, schema validation, animations and
translations all come in the box.

A Go compiler with esbuild inside turns the app into one small bundle. A
minimal app is **21.9 KB gzip** with the router, store and validation
included, and the complete todos example is **25.9 KB gzip**. The CLI is a
single prebuilt binary: no Babel, no bundler config, no postinstall scripts.

**[Live demo: Puzzle Sounds](https://puzzle-music-demo.vercel.app/)**, a
Spotify-style music app with layout swaps, view transitions, skeleton loading,
shared-element morphs, and a player whose state survives a reload. Source:
[`packages/puzzle/examples/music`](packages/puzzle/examples/music).

## Quick start

```bash
npm install -g @magic-spells/puzzle

puzzle init my-app
cd my-app
npm install

puzzle dev     # dev server with live reload
puzzle build   # production build to dist/
```

`puzzle init my-app --template todos` starts from a todo app with a model and
the store instead. Prebuilt binaries ship for macOS and Linux (arm64, x64) and
Windows x64. Puzzle is pre-1.0, so a 0.x minor can carry breaking changes; read
the [CHANGELOG](packages/puzzle/CHANGELOG.md) before you upgrade.

## App structure

```
my-app/
├── app/
│   ├── app.js              # creates the PuzzleApp: mount target, routes, models, formatters
│   ├── routes.js           # the route table: path → view, layout, child routes
│   ├── views/              # routed pages
│   │   ├── Home.pzl
│   │   └── NotFound.pzl    # the '*' catch-all
│   ├── layouts/            # page shells; the routed view renders at <Slot/>
│   │   └── Default.pzl
│   ├── components/         # reusable .pzl components
│   │   └── Counter.pzl
│   ├── models/             # store models: schema, getters, methods (todos template)
│   ├── locales/            # en.json, es.json, … once i18n is configured
│   ├── assets/             # source assets, e.g. SVGs inlined with {#svg 'icons/heart.svg'}
│   ├── styles/
│   │   └── styles.css      # Tailwind entry and global CSS
│   └── public/             # static files copied into dist/
│       └── index.html      # the page shell with <div id="app">
├── puzzle.config.js        # build config: style pipeline, output mode, i18n
├── jsconfig.json           # maps the @/ import alias to app/
└── package.json
```

`puzzle build` writes `dist/`. `.puzzle/` is the compiler's scratch directory
and is gitignored. `puzzle generate view Album` (or `component`, `layout`,
`model`) adds a stub in the right folder.

## How it works

### A component

A `.pzl` file is a template, a `<script>` and an optional `<style>`. `data()`
returns what the template reads. Handlers live in an `events` field.
`{ value | formatter }` formats a value for display.

```html
<!-- app/components/TrackList.pzl -->
<puzzle-view>
  <section>
    <h2>{ title }</h2>
    <p class="count">{ tracks.size | pluralize('track') }</p>

    {#if tracks.size > 0}
      <ol>
        {#for track in tracks}
          <li>
            <span>{ track.title }</span>
            <span class="plays">{ track.plays | compact_number } plays</span>
            <button class="like {#if track.liked}on{/if}" @click={ like(track) }>
              {#if track.liked}Liked{:else}Like{/if}
            </button>
          </li>
        {/for}
      </ol>
    {:else}
      <p>No tracks yet.</p>
    {/if}
  </section>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class TrackList extends PuzzleView {
  // Runs on mount and whenever the props or the store data it read change.
  data(params, props) {
    return { title: props.title, tracks: props.tracks };
  }

  // Handlers are arrow functions, so `this` is always the component.
  events = {
    like: (track) => track.toggleLike(),
  };
}
</script>

<style scoped>
  li { display: flex; gap: 1rem; }
  .plays { color: #6b7280; }
  .on { color: #e11d48; }
</style>
```

`pluralize` prints `2 tracks` and `compact_number` prints `45K`. A template
expression is data plus operators: fields, `.size` for a count, `+ - * / %`,
comparisons and `??` for a fallback. It never calls JavaScript on a value
(`name.trim()` and `.length` are compile errors); that work goes in `data()`.
A template never reaches the view instance: `this` is a compile error in every
template expression, and an `@event` handler reaches the view through its own
name (`@click={ save(x) }` calls the view's `save`). Formatters chain left to
right and take arguments. They go in values only: an `{#if}` or `{#for}` header
takes no pipe, so compute that value in `data()`. A path like
`{ user.address.city }` prints nothing instead of throwing when `address` is
missing.

### Routes

```js
// app/routes.js
import { lazy } from '@magic-spells/puzzle';
import Home from './views/Home.pzl';
import Album from './views/Album.pzl';
import NotFound from './views/NotFound.pzl';
import Default from './layouts/Default.pzl';

export default [
  { path: '/', name: 'home', view: Home, layout: Default, meta: { title: 'Home' } },
  { path: '/album/:id', name: 'album', view: Album, layout: Default },
  // Downloaded the first time a navigation needs it.
  { path: '/settings', name: 'settings', view: lazy(() => import('./views/Settings.pzl')), layout: Default },
  { path: '*', name: 'not-found', view: NotFound, layout: Default },
];
```

```js
// app/app.js
import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({ target: '#app', routes, models });

app.mount();
export default app;
```

A navigation loads the next view's data before anything changes, then commits
the URL, title and page together. Routes nest with `children`, and a layout
stays mounted while the views inside it swap. Path routing is the default;
hash and memory routing are `hashRouter()` and `memoryRouter()` from
`@magic-spells/puzzle/router-modes`. Write links path-shaped with the `link`
formatter, `href="{ '/album/' + album.id | link }"`, and they work in every
mode.

### Models and the store

```js
// app/models/track.js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Track extends PuzzleModel {
  static schema = {
    id:      Puzzle.string().primary(),
    title:   Puzzle.string().required(),
    albumId: Puzzle.string().required(),
    plays:   Puzzle.number().default(0),
    liked:   Puzzle.boolean().default(false),
  };

  toggleLike() {
    return this.update({ liked: !this.liked });
  }
}
```

```html
<!-- app/views/Album.pzl -->
<puzzle-view>
  <TrackList title="Popular" tracks={ tracks } />
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import TrackList from '@/components/TrackList.pzl';

export default class Album extends PuzzleView {
  data(params) {
    // Reading the store here subscribes the view: a like, a new track or a
    // deleted one re-runs data() and re-renders.
    const tracks = this.ctx.store
      .findMany('track', { filter: (t) => t.albumId === params.id })
      .sort((a, b) => b.plays - a.plays);

    return { tracks };
  }
}
</script>
```

Clicking "Like" in the list calls `track.toggleLike()`. The store validates the
change against the schema and notifies every view that read that track, so the
button updates with no extra code. For server data, give the model
`static adapter = { endpoint: '/tracks' }` and pass the `adapter` capability
from `@magic-spells/puzzle/adapter` to `PuzzleApp`. The same `findMany` then
fetches what the store is missing, and the view commits once the data has
arrived. There is no loading state to write. Apps without an adapter ship none
of that code.

### Translations

Add the locales to `puzzle.config.js` and one JSON file per locale under
`app/locales/`:

```js
// puzzle.config.js
export default {
  styles: { use: ['tailwindcss'] },
  i18n: { locales: ['en', 'es'], defaultLocale: 'en' },
};
```

`app/locales/en.json`:

```json
{
  "greeting": "Welcome back, {name}!",
  "cart": {
    "items": {
      "zero": "Your cart is empty",
      "one": "{count} item",
      "other": "{count} items"
    }
  }
}
```

```html
<!-- app/views/Home.pzl -->
<puzzle-view>
  <h1>{ 'greeting' | t({ name: user.name }) }</h1>
  <p>{ 'cart.items' | t({ count: cart.count }) }</p>
  <button @click={ switchTo('es') }>Español</button>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class Home extends PuzzleView {
  data() {
    return { user: { name: 'Ada' }, cart: { count: 3 } };
  }

  events = {
    // Loads es.json, then rebuilds the page in place and remembers the choice.
    switchTo: (tag) => this.ctx.i18n.setLocale(tag),
  };
}
</script>
```

The compiler checks every locale file, fills missing keys from the default
locale, and emits one hashed file per locale; the browser downloads only the
active one. A numeric `count` picks the plural form through
`Intl.PluralRules`, and dates and numbers follow the active locale. Apps
without `i18n` ship none of it. See
[`examples/i18n`](packages/puzzle/examples/i18n) for English, Spanish and
Polish with a live locale switch.

### Build output

`puzzle build` produces a single-page app by default. Two optional prerender
modes are there when you need HTML up front: `output: 'hybrid'` prerenders each
page and the SPA takes over, and `output: 'static'` emits plain static pages
with no router and no `app.js`. There is no request-time server.

## Examples

Every example is a complete app under
[`packages/puzzle/examples`](packages/puzzle/examples):

| Example | What it shows |
|---|---|
| [music](packages/puzzle/examples/music) | The [live demo](https://puzzle-music-demo.vercel.app/): layout swaps, view transitions, skeletons, shared-element morphs, hash routing |
| [todos](packages/puzzle/examples/todos) | The canonical app: a model, the store, two-way form binding, an All / Active / Completed toggle |
| [i18n](packages/puzzle/examples/i18n) | Translations in three languages, plural forms, a live locale switch |
| [stays](packages/puzzle/examples/stays) | An Airbnb-style marketplace: nested routes, callback props, store updates across pages |
| [blog](packages/puzzle/examples/blog) | Several models, route params, auto-fetching server data, `lazy()` routes, plain `<style>` blocks |
| [chirp](packages/puzzle/examples/chirp) | A Twitter-style feed: skeleton loaders, `{#case}` and `{#unless}`, event modifiers |
| [kanban-morph](packages/puzzle/examples/kanban-morph) | A drag-and-drop board whose cards morph open into a detail dialog |
| [grimoire](packages/puzzle/examples/grimoire) | A Notion-style block editor built on DOM islands |
| [canvas](packages/puzzle/examples/canvas) | A mini-Figma: drag, resize and edit shapes over store-driven rendering |
| [static-docs](packages/puzzle/examples/static-docs) | A docs site built with `output: 'static'`: one HTML file per page, no router |
| [typed-todos](packages/puzzle/examples/typed-todos) | TypeScript in `.pzl` scripts, models and routes |
| [hello-world](packages/puzzle/examples/hello-world) | The smallest app, and the baseline for the size figures above |

The [framework README](packages/puzzle/README.md) covers the full template
syntax, every built-in formatter and every CLI command.

## This repository

The repo root is a private shell. Everything that releases in lockstep with the
framework lives under `packages/`:

| Package | What it is | Ships as |
|---|---|---|
| [`packages/puzzle`](packages/puzzle) | The framework: runtime, compiler, CLI, examples | `@magic-spells/puzzle` on npm |
| [`packages/puzzle-lang`](packages/puzzle-lang) | The Puzzle language as a Go module: lexer, section splitter, AST, positioned errors | Go module, tagged `packages/puzzle-lang/vX.Y.Z` |
| [`packages/puzzle-pieces`](packages/puzzle-pieces) | Copy-in UI component registry for `puzzle add piece` | `@magic-spells/puzzle-pieces` on npm |
| [`packages/puzzle-devtools`](packages/puzzle-devtools) | Chrome DevTools extension | extension zip (never npm) |
| [`packages/puzzle-eslint`](packages/puzzle-eslint) | ESLint plugin for `.pzl` files | `@magic-spells/eslint-plugin-puzzle` (not yet published) |
| [`packages/puzzle-prettier`](packages/puzzle-prettier) | Prettier 3 plugin for `.pzl` files | `@magic-spells/prettier-plugin-puzzle` (not yet published) |

Every package in the release train carries the framework's version.

### Components

[Puzzle Pieces](packages/puzzle-pieces) is the official component library:
ready-made `.pzl` components you copy into an app with
`puzzle add piece <name>`. Preview them at
[magicspells.io/puzzle-pieces](https://magicspells.io/puzzle-pieces).

### Editor support

Editor grammars live in their own repos:
[vscode](https://github.com/magic-spells/puzzle-vscode),
[sublime](https://github.com/magic-spells/puzzle-sublime) and
[zed](https://github.com/magic-spells/puzzle-zed).

### Working on Puzzle

```bash
cd packages/puzzle
npm install && npm test          # framework suite
npm run build:compiler           # emits ./puzzle, the CLI the other packages build with
(cd compiler && go test ./...)   # compiler tests
(cd ../puzzle-lang && go test ./...)   # parser tests (a separate Go module)
```

## License

MIT © Magic Spells
