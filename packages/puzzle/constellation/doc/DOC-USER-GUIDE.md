---
name: USER_GUIDE.md — application building guide
status: built
connections:
  - DOC-SPEC
  - DOC-PUZZLE-FILE
  - DOC-DATASTORE
  - DOC-COMPILATION-FLOW
  - DOC-TEMPLATE-SYNTAX
  - DOC-MODELS
  - DOC-ROUTER
---

End-to-end app-building guide, worked against the in-repo `examples/blog` reference app ("Puzzle Press"). It walks the path an app author takes and links the reference cards for detail: [[DOC-TEMPLATE-SYNTAX]] (template grammar), [[DOC-MODELS]] and [[DOC-DATASTORE]] (data), [[DOC-ROUTER]] (routing), [[DOC-EVENTS]] (events), and the enforceable contract in [[DOC-SPEC]] and its `DOC-SPEC-*` chapters.

# Puzzle User Guide

## Quick start

The CLI is a prebuilt Go binary shipped through npm; no JavaScript toolchain is needed to run it.

```bash
npm install -g @magic-spells/puzzle
puzzle init my-app            # --template default|todos, --typescript
cd my-app && npm install
puzzle dev                    # watch + live reload
puzzle build                  # production build
```

`puzzle init` is the only onboarding path; there is no `npx create-*` wrapper ([[DECISION-D77-INIT-PROMPTS]]). The generated app depends on `@magic-spells/puzzle` locally, so collaborators only need `npm install`. To add Puzzle to an existing project, `npm install -D @magic-spells/puzzle` gives both the client runtime and the CLI.

`--typescript` scaffolds `<script lang="ts">` components, `.ts` modules and entry `app/app.ts`, a strict `tsconfig.json`, and a `check` script (`puzzle check`). The build starts from `app/app.ts` when it exists, otherwise `app/app.js`, and refuses an app with both. It strips types without checking them; `puzzle check` is the type check. In an app with a `tsconfig.json`, `puzzle generate` writes TypeScript stubs.

## Project structure

```
my-app/
├── app/
│   ├── app.js | app.ts   # PuzzleApp config + mount
│   ├── routes.js         # route table
│   ├── models/           # PuzzleModel classes + index.js registry
│   ├── views/            # routed .pzl views (subfolders allowed)
│   ├── components/       # reusable .pzl components
│   ├── layouts/          # route layouts with <Slot/>
│   ├── assets/           # source assets, incl. {#svg} files
│   ├── locales/          # <tag>.json translation files (optional)
│   ├── styles/           # Tailwind entry + global CSS
│   └── public/           # index.html + static files (copied to dist/)
├── puzzle.config.js      # styles, i18n, dev proxy, output, build options
└── package.json          # dist/ is build output, git-ignored
```

`@` is a built-in alias for `app/` in every module import (`import PostCard from '@/components/PostCard.pzl'`), from any depth, mixing freely with relative imports. `puzzle init` writes the matching `paths` entry (`"@/*": ["./app/*"]`) into `jsconfig.json`/`tsconfig.json` for editors; an older app adds it by hand. It applies to module imports only: `{#svg '…'}` paths already resolve against `app/assets/`, and CSS `@import`s are unaffected.

Styling is either per-file `<style>` blocks (optionally `scoped`) or the Tailwind pipeline: `puzzle add tailwind` wires `styles: { use: ['tailwindcss'] }` in `puzzle.config.js`, and `puzzle dev`/`build` run it automatically. `puzzle add theme` lists and installs registry palettes. `examples/blog` uses Tailwind.

## App entry

```javascript
// app/app.js
import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
import routes from './routes.js';
import models from './models/index.js';

const app = new PuzzleApp({
  target: '#app',
  routes,
  models,
  adapter,          // opt-in server sync; tracked finds fetch on miss (D161)
  apiURL: '/api',   // adapter endpoints join onto this
  formatters: {     // app display functions, called by name in templates
    byline: (name) => (name ? `By ${name}` : 'By an unknown author')
  }
});

app.mount();
export default app;
```

The core config is `target`, `routes`, `models`, `formatters`, `apiURL`, plus optional capabilities and hooks (`adapter`, `scrollBehavior`, `routerMode`, `beforeMount`/`mounted`/`beforeUnmount`, `onError`, …); see [[DOC-SPEC-ANATOMY]] §2 and [[DOC-SPEC-VIEW]] §34/§60. There is no seeding step.

## Routes

`app/routes.js` exports an array of `{ path, name, view, layout?, meta? }` entries (`{ path: '/posts/:id', name: 'post', view: PostDetailView, layout: DefaultLayout }`). A `:id` segment arrives as `params.id` in `data(params, props)`; `'*'` is matched last and renders the 404 view. A layout renders the routed view at `<Slot/>`. Nested routes, guards, lazy views, query, head tags, scroll and focus behavior are in [[DOC-ROUTER]].

## Models

```javascript
// app/models/post.js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Post extends PuzzleModel {
  static schema = {
    id:          Puzzle.string().primary(),
    title:       Puzzle.string().required(),
    body:        Puzzle.string().required(),
    authorId:    Puzzle.string(),
    tags:        Puzzle.array().default(() => []),
    publishedAt: Puzzle.date(),
    author:      Puzzle.belongsTo('user'),    // FK 'authorId' inferred
    comments:    Puzzle.hasMany('comment')    // FK 'postId' inferred
  };

  // Computed properties are plain getters (the blog also defines readingTime).
  // Server dates arrive as ISO strings, so coerce.
  get publishedDate() { return new Date(this.publishedAt); }

  static adapter = {
    endpoint: '/posts.json',   // findMany('post') GETs /api/posts.json
    // Any single verb can be replaced by a fetch function. The static demo
    // "server" has no per-record URLs, so loadOne reads the collection file.
    async loadOne(fetch, id) {
      const res = await fetch('/api/posts.json');
      if (!res.ok) return res;
      const posts = await res.json();
      return posts.find((p) => String(p.id) === String(id)) ?? new Response(null, { status: 404 });
    }
  };
}
```

`models/index.js` exports `{ user: User, post: Post, comment: Comment }`. A model with no `adapter` (the blog's browser-created `Comment`) keeps every find a local read.

- `endpoint` generates the REST transports; a fetch function overrides one verb, or several form a no-endpoint adapter. A non-OK `Response` becomes a `PuzzleAdapterError`; a 404 on the auto-fetch path commits `null`.
- Passing `adapter` to `PuzzleApp` installs `loadMany`/`loadOne`, `upsert`/`request`, record `save()`/`delete()` and auto-fetching finds; without it none of that runtime ships. `record.destroy()` is always local-only.
- Validation is core: `createRecord` and `update` throw `PuzzleValidationError`; `Model.validate(data, { fields })` returns `{ valid, errors }` for form UX.

Builders, relationships, write sync, fixtures and the mock adapter: [[DOC-MODELS]], [[DOC-DATASTORE]], [[DOC-SPEC-DATA]].

## Views

A view is a `.pzl` file: a `<puzzle-view>` template, a `<script>` exporting a `PuzzleView` subclass, and an optional `<style>`. Anatomy and the full component reference: [[DOC-PUZZLE-FILE]].

```html
<!-- app/views/PostDetail.pzl (abridged) -->
<puzzle-view class="detail">
  {#if post}
    <h1>{ post.title }</h1>
    <p>
      {#if author}{ byline(author.name) } · {/if}
      { date(post.publishedAt, 'long') } · { post.readingTime } min read
    </p>
    <p>{ post.body }</p>

    <h2>{ pluralize(comments.length, 'comment') }</h2>
    {#for comment in comments}
      <CommentItem comment={ comment } @remove={ removeComment(comment) }></CommentItem>
    {/for}

    <form @submit={ addComment(event) }>
      <input type="text" placeholder="Your name" value={ authorName } />
      <textarea value={ commentText }></textarea>
      <button type="submit" disabled={ !canComment }>Add comment</button>
    </form>
  {:else}
    <h1>Post not found</h1>
  {/if}
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';
import CommentItem from '@/components/CommentItem.pzl';

export default class PostDetailView extends PuzzleView {
  created() {
    this.setData({ commentText: '', authorName: '' });   // local form state
  }

  data(params, props) {
    const store = this.ctx.store;
    const local = this.getData();
    const post = store.findOne('post', params.id);
    // Relationships never fetch; a view that needs the related record asks
    // for it with one more tracked find on the foreign key.
    const author = post ? store.findOne('user', post.authorId) : null;
    const comments = post ? [...post.comments].sort((a, b) => a.createdAt - b.createdAt) : [];
    return {
      post, author, comments,
      commentText: local.commentText,
      authorName: local.authorName,
      canComment: (local.commentText ?? '').trim() !== ''
    };
  }

  events = {
    addComment: (event) => {
      event.preventDefault();
      const { commentText, authorName } = this.getData();
      if (!commentText.trim()) return;
      this.ctx.store.createRecord('comment', {
        postId: this.params.id, author: authorName.trim() || 'Anonymous', text: commentText.trim()
      });
      this.setData({ commentText: '', authorName: '' });
      this.refresh();
    },
    removeComment: (comment) => comment.destroy()   // the parent owns the mutation
  };
}
</script>
```

What this shows:

- **`data(params, props)`** receives only route params and props; nothing ambient is injected, and props flow parent to child. It may be `async`, runs on mount, on param/prop change and when a store read it made changes, and auto-subscribes to every store query it runs.
- **Auto-fetch (D161):** with the adapter installed, a tracked `findOne`/`findMany` miss runs the model's read verb, and the view commits only once every read settles (here: the post in round 1, the author in round 2). A committed `null` means "does not exist", never "still loading", so the `{:else}` branch needs no loading flag.
- **Display functions are calls** (D176): `byline` is the app function from `app.js`; `date` and `pluralize` are standard. The count is `.length`.
- **Templates never reach the instance**: `this` is a compile error in a template, so view logic lives in `data()` and the template reads named fields like `canComment`.
- **Components are any tag whose first character is not `a-z`** (D167): `<CommentItem>`, or a dotted family member like `<Frame.Content>`, resolved against the script's imports.

### Template essentials

```html
{#if user.isLoggedIn}<p>Welcome, { user.name }!</p>{:else}<p>Please log in</p>{/if}
{#for post in posts, i}<div>{ i + 1 }. { post.title }</div>{/for}
{ capitalize(user.name) }  { currency(price, '$', 2) }  { tags.join(', ') }
{ t('cart.items', { count: cart.count }) }
{ raw(post.bodyHtml) }
```

Expressions are JavaScript-shaped from a closed table: operators, `??`, optional chaining, arrow callbacks, `Math.*`, and allowlisted string/array methods (`.trim()`, `.toUpperCase()`, `.filter(…)`, `.toSorted(…)`, `.at(-1)`, `.join(…)`). Display functions are the 19-function standard library plus browser-only `link` and `timeago`, plus the app's own `formatters`; an app function reusing a standard name wins with a dev warning, and an unregistered name passes the value through with one `console.error`. `raw` and `newline_to_br` must be the outermost call of a text interpolation; `raw` always sanitizes. Grammar, the function list, markup-function rules, `{#svg}`, `{#raw}`, snippets and whitespace: [[DOC-TEMPLATE-SYNTAX]] and [[DOC-SPEC-TEMPLATE]].

Translations: `i18n: { locales, defaultLocale }` in `puzzle.config.js`, one `app/locales/<tag>.json` per locale, `{ t('key', { name }) }` in templates (a numeric `count` picks the plural form, a missing key prints the key), and `this.ctx.i18n.setLocale('es')` to switch. See [[DECISION-D175-TRANSLATIONS]].

## Form binding (D147)

`value={ … }` and `checked={ … }` on a plain `<input>`, `<textarea>` or `<select>` bind both ways when the expression is a bare key or a one-member path; the compiler writes the handler. **Bind the path you want written:**

- **Local draft, bare key** (`value={ authorName }`): the write is `setData` + `refresh`, so everything `data()` derives from the key recomputes as the user types. Seed the key in `created()` and read it back in `data()` with `this.getData()` so it survives store-driven re-runs.
- **Record field, one-member path** (`checked={ profile.subscribed }`): each edit goes through `record.update()`, so validation runs and every subscribed view re-renders. Bind the record path rather than copying the field into a local key: a local key `data()` also derives from the record is overwritten on the next commit (dev warns once per key).
- **Constrained field, draft + submit:** a bound record path validates every keystroke, so a `required()` field could never be emptied and a `min(3)` rule rejects mid-word. Bind a local draft, check it with `Model.validate({ text: draft }, { fields: ['text'] })` on submit, then `record.update(...)`. A rejected `update()` throws and changes nothing; when a bind triggers the rejection, `onError` receives `phase: 'bind'`.
- **Opting out:** your own `@input`/`@change` suppresses the synthesized write; a non-path expression (`value={ name ?? '' }`) or a static `readonly` does not bind. Handlers on other events (`@blur`, `@keydown:enter`) coexist with the bind, so a bound field is never an abandonable edit buffer; use the non-path form when Escape must revert.

`@magic-spells/puzzle/testing` ships `mountView` and `type()`: `await view.type('.name', 'Ada')` replaces the value, fires the events a real edit produces, and waits for the view to settle. See [[DOC-TESTING]] and [[DOC-SPEC-BUILD]] §53.

## Components

A reusable component renders inline: its `<puzzle-view>` carries no attributes and wraps a single root element (attributes on it are a compile error; put them on the root). Default child content is projected through `<Children/>`; named regions are `<Slot name="header"/>`, filled by a direct child with a static `slot="header"`.

```html
<!-- app/components/Button.pzl -->
<puzzle-view>
  <button class="btn btn--{ variant }" type={ type } disabled={ disabled } @click={ handleClick }>
    <Children/>
  </button>
</puzzle-view>

<script>
import { PuzzleView } from '@magic-spells/puzzle';

export default class Button extends PuzzleView {
  data(params, props) {
    return { variant: props.variant || 'primary', type: props.type || 'button', disabled: props.disabled || false };
  }
  events = {
    handleClick: (event) => {
      if (this.getData().disabled) return;
      const { press } = this.props;
      if (typeof press === 'function') press(event);
    }
  };
}
</script>
```

The parent writes `<Button variant="primary" @press={ goToPosts }>Browse</Button>`. `@press` on a component tag is a **callback prop** (D16): the child receives a function on `this.props.press` and calls it from its own DOM listener. There is no `$emit`; the child reports intent and the parent owns mutations. Related components can ship as a family: a directory with a JS barrel (`export default Object.assign(Frame, { Wrapper, Content })`), used as `<Frame.Wrapper>`; `puzzle generate component Frame --family Wrapper,Content` scaffolds it.

## Key patterns

### data() rules

- **Never call `store.loadMany`/`loadOne` inside `data()`**: tracked finds already fetch, and dev warns about the redundant load. The explicit loads are escape hatches outside tracked runs; `store.loadOne` in an event handler is the force-refresh idiom (it bypasses the negative cache).
- **Relationships never fetch** (`post.author`), which keeps a 50-row list from firing 50 GETs; write the tracked find on the foreign key when a view needs the record.
- **`setData()` does not re-run `data()`** (D23). When `data()` derives something from local state (a filtered list, a flag), follow `setData(...)` with `this.refresh()`:

```javascript
events = {
  setTag: (tag) => {
    this.setData('activeTag', tag);
    this.refresh();   // re-run data() so the filtered list follows
  }
};
```

### Stable object props: `this.memo()`

Props compare with shallow `===`, so an object or array prop compares by reference. If `data()` builds a fresh object every run, the child re-runs its `data()` on every unrelated change. Wrap derived objects in `this.memo(key, deps, factory)`; the cached value returns until an entry of `deps` differs by `Object.is`:

```javascript
data() {
  const { effect = 'carousel' } = this.getData();
  return { carouselOptions: this.memo('opts', [effect], () => ({ effect, loop: true })) };
}
```

Primitive props need no memo, and data-independent callback props are cached by the compiler. See [[DOC-SPEC-VIEW]] §32.

### Events

`events` is a class field of arrow functions. A bare identifier (`@click={ handleClick }`) receives the DOM `event`; a call (`@submit={ addComment(event) }`) passes exactly the arguments written, evaluated at event time with `event` in scope. Modifiers stack: `@keydown:enter`, `@keydown:escape:prevent`, `@click:once`, `@click:outside`. Full rules, cached handlers and the `@ready` callback-ref idiom: [[DOC-EVENTS]].

### Animations

An `animations` class field on any view, layout or component animates it in and out via the Web Animations API. `in`/`out` are `{ from, to, duration, easing?, delay? }`:

```js
animations = {
  in:  { from: { opacity: 0, transform: 'translateY(10px)' }, to: { opacity: 1, transform: 'translateY(0)' }, duration: 260, easing: 'ease-out' },
  out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 160 }
};
```

- The target is the instance's root element, and `to` must equal its resting style (enter styles are released when it finishes). Height cannot animate to `auto`; use explicit `px` or a `grid-template-rows: 0fr → 1fr` wrapper.
- Views animate on route change (old `out`, then new `in`); components animate when added to or removed from a list. `viewWillShow`/`viewDidShow`/`viewWillHide`/`viewDidHide` bracket the phases even with no `animations` field. `prefers-reduced-motion: reduce` zeroes durations; a malformed spec warns once and is skipped.
- `trigger: 'visible'` holds the element at `from` until it scrolls into view, then plays once per mount. `triggerOffset` (px or `'%'`) raises the trigger line above the viewport bottom; `triggerAnchor: '.section'` reveals when a matching ancestor enters, so siblings fire together and stagger by `delay`. Without `IntersectionObserver`, or under reduced motion, content shows immediately. Keep above-the-fold content on the default mount trigger.

FLIP reorders, cross-view morphs, skeletons and refs: [[DOC-SPEC-VIEW]].

## Backends in dev

```javascript
// puzzle.config.js
export default { dev: { proxy: { '/api': 'http://localhost:3091' } } };
```

`puzzle dev` forwards `/api` and `/api/*` with the path unchanged, so the app can use `apiURL: ''` and stay same-origin with no CORS. A prefix must start with `/` and cannot be the root. Restart the dev server after changing it; production builds ignore it.

## Commands

`puzzle dev`, `puzzle build` (`--static`, `--hybrid` for prerendered output), `puzzle preview`, `puzzle check`, `puzzle generate`, `puzzle add tailwind|theme|piece|skills`, `puzzle doctor`, `puzzle info`, `puzzle upgrade`. Flags, output modes and the dev loop: [[DOC-SPEC-BUILD]] and [[DOC-COMPILATION-FLOW]].
