---
name: App-building guide (worked against examples/blog)
status: built
connections:
  - DOC-SPEC
  - DOC-PUZZLE-FILE
  - DOC-TEMPLATE-SYNTAX
  - DOC-EVENTS
  - DOC-MODELS
  - DOC-DATASTORE
  - DOC-ROUTER
  - DOC-TESTING
  - DOC-APP-STRUCTURE
---

# Puzzle app-building guide

The path an app author takes, worked against the in-repo `examples/blog` reference app. It teaches the patterns and gotchas; the reference cards hold detail — [[DOC-TEMPLATE-SYNTAX]], [[DOC-EVENTS]], [[DOC-MODELS]], [[DOC-DATASTORE]], [[DOC-ROUTER]] — and [[DOC-SPEC]] holds the contract.

## Quick start

The CLI is a prebuilt Go binary shipped through npm.

```bash
npm install -g @magic-spells/puzzle
puzzle init my-app            # --template default|todos, --typescript
cd my-app && npm install
puzzle dev                    # watch + live reload
puzzle build                  # production build
```

`puzzle init` is the only onboarding path; there is no `npx create-*` wrapper ([[DECISION-D77-INIT-PROMPTS]]). The app depends on `@magic-spells/puzzle` locally, so collaborators only need `npm install`; `npm install -D @magic-spells/puzzle` adds runtime + CLI to an existing project.

`--typescript` scaffolds `<script lang="ts">` components, `app/app.ts`, a strict `tsconfig.json` and a `check` script. The build strips types without checking them; `puzzle check` is the type check. With a `tsconfig.json`, `puzzle generate` writes TypeScript stubs.

## Project structure

```
my-app/
├── app/
│   ├── app.js | app.ts   # PuzzleApp config + mount
│   ├── routes.js         # route table
│   ├── models/           # PuzzleModel classes + index.js registry
│   ├── views/            # routed .pzl views
│   ├── components/       # reusable .pzl components
│   ├── layouts/          # route layouts with <Slot/>
│   ├── assets/           # source assets, incl. {#svg} files
│   ├── locales/          # <tag>.json translations (optional)
│   ├── styles/           # Tailwind entry + global CSS
│   └── public/           # index.html + static files (copied to dist/)
├── puzzle.config.js      # styles, i18n, dev proxy, output, build options
└── package.json
```

`@/` resolves to `app/` in every module import, from any depth (`import PostCard from '@/components/PostCard.pzl'`); `puzzle init` writes the matching `paths` entry for editors. `{#svg '…'}` paths resolve against `app/assets/`. Styling is per-file `<style>` (optionally `scoped`) or Tailwind: `puzzle add tailwind` wires `styles: { use: ['tailwindcss'] }`. [[DOC-APP-STRUCTURE]] has the layout rules.

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
  adapter,          // opt-in server sync; tracked finds fetch on miss
  apiURL: '/api',   // adapter endpoints join onto this
  formatters: {     // app functions, called by name in templates
    byline: (name) => (name ? `By ${name}` : 'By an unknown author')
  }
});

app.mount();
export default app;
```

All config keys: [[DOC-SPEC-ANATOMY]] §2. There is no seeding step.

## Routes

`app/routes.js` exports `{ path, name, view, layout?, meta? }` entries. A `:id` segment arrives as `params.id` in `data(params, props)`; `'*'` matches last and renders the 404 view. A layout renders the routed view at `<Slot/>`. Nesting, guards, lazy views, query, head, scroll and focus: [[DOC-ROUTER]].

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

  // Computed properties are plain getters. Server dates arrive as ISO strings.
  get publishedDate() { return new Date(this.publishedAt); }

  static adapter = {
    endpoint: '/posts.json',   // findMany('post') GETs /api/posts.json
    // Any one verb can be a fetch function. This static demo "server" has no
    // per-record URLs, so loadOne reads the collection file.
    async loadOne(fetch, id) {
      const res = await fetch('/api/posts.json');
      if (!res.ok) return res;
      const posts = await res.json();
      return posts.find((p) => String(p.id) === String(id)) ?? new Response(null, { status: 404 });
    }
  };
}
```

`models/index.js` exports `{ user: User, post: Post, comment: Comment }`. A model with no `adapter` keeps every find a local read.

- A non-OK `Response` becomes a `PuzzleAdapterError`; a 404 on the auto-fetch path commits `null`.
- Without `adapter` in the app config, none of the sync runtime ships. `record.destroy()` is always local-only; `save()`/`delete()` sync.
- Validation is core: `createRecord` and `update` throw `PuzzleValidationError`; `Model.validate(data, { fields })` returns `{ valid, errors }` for form UX.

## Views

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
    // Relationships never fetch; ask for the related record with one more
    // tracked find on the foreign key.
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

- **`data(params, props)`** receives only route params and props. It may be `async`, runs on mount, on param/prop change and when a store read it made changes, and subscribes to every store query it runs.
- **Auto-fetch:** with the adapter installed, a tracked `findOne`/`findMany` miss runs the model's read verb, and the view commits only once every read settles (here the post in round 1, the author in round 2). A committed `null` means "does not exist", never "still loading", so `{:else}` needs no loading flag.
- **Templates never reach the instance:** `this` is a compile error in a template, so logic lives in `data()` and the template reads named fields like `canComment`. Functions are calls (`byline(…)`, `date(…)`); the count is `.length`.
- **Components** are tags whose first character is not `a`–`z`, resolved against the script's imports.

## Form binding

`value={ … }` and `checked={ … }` on a plain `<input>`, `<textarea>` or `<select>` bind both ways when the expression is a bare key or a one-member path ([[DECISION-D147-IMPLICIT-TWO-WAY-BINDING]]). **Bind the path you want written:**

- **Local draft, bare key** (`value={ authorName }`): the write is `setData` + `refresh`, so everything `data()` derives from the key recomputes as the user types. Seed the key in `created()` and read it back in `data()` with `this.getData()`.
- **Record field, one-member path** (`checked={ profile.subscribed }`): each edit goes through `record.update()`, so validation runs and subscribed views re-render. Bind the record path rather than copying the field into a local key `data()` also derives from the record — that key is overwritten on the next commit (dev warns once per key).
- **Constrained field, draft + submit:** a bound record path validates every keystroke, so a `required()` field could never be emptied. Bind a local draft, check it with `Model.validate({ text: draft }, { fields: ['text'] })` on submit, then `record.update(...)`. A rejected bind reaches `onError` with `phase: 'bind'`.
- **Opting out:** an author `@input`/`@change` suppresses the synthesized write; a non-path expression (`value={ name ?? '' }`) or a static `readonly` does not bind. Use the non-path form when Escape must revert.

`@magic-spells/puzzle/testing`'s `type()` drives a bound control the way a real edit does ([[DOC-TESTING]]).

## Components

A component's `<puzzle-view>` carries no attributes and wraps one root element. Default content projects through `<Children/>`; named regions are `<Slot name="header"/>`, filled by a direct child with a static `slot="header"`.

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

The parent writes `<Button variant="primary" @press={ goToPosts }>Browse</Button>`. `@press` on a component is a **callback prop**: the child calls `this.props.press`. There is no `$emit`; the child reports intent and the parent owns mutations. Related components ship as a family (`<Frame.Wrapper>`); `puzzle generate component Frame --family Wrapper,Content` scaffolds one.

## Key patterns

- **Never call `store.loadMany`/`loadOne` inside `data()`** — tracked finds already fetch, and dev warns. The explicit loads are for event handlers; `store.loadOne` there is the force-refresh idiom.
- **Relationships never fetch** (`post.author`), so a 50-row list never fires 50 GETs; write the tracked find on the foreign key when a view needs the record.
- **`setData()` does not rerun `data()`** ([[DECISION-D23-REFRESH-PATTERN]]). When `data()` derives from local state, follow `setData(...)` with `this.refresh()`.
- **Stable object props:** props compare with `===`, so a fresh object from every `data()` run re-runs the child. Wrap derived objects in `this.memo(key, deps, factory)` ([[DOC-SPEC-VIEW]] §32). Primitive props need no memo, and data-independent callback props are cached by the compiler.
- **Animations:** an `animations = { in, out }` class field animates the instance root via WAAPI; `to` must equal the resting style and height cannot animate to `auto` ([[DOC-SPEC-VIEW]] §12, §39).

## Backends in dev

```javascript
// puzzle.config.js
export default { dev: { proxy: { '/api': 'http://localhost:3091' } } };
```

`puzzle dev` forwards `/api` and `/api/*` with the path unchanged, so the app can use `apiURL: ''` and stay same-origin. A prefix must start with `/` and cannot be the root. Restart after changing it; production builds ignore it.

## Commands

`puzzle dev`, `puzzle build` (`--static`, `--hybrid`), `puzzle preview`, `puzzle check`, `puzzle generate`, `puzzle add tailwind|theme|piece|skills`, `puzzle doctor`, `puzzle info`, `puzzle upgrade`. Flags: [[DOC-RELEASE-SURFACE]] and [[DOC-SPEC-BUILD]] §13.
