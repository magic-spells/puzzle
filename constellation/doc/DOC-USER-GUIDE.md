---
name: USER_GUIDE.md — application building guide
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DOC-BLOG-EXAMPLE
  - DOC-SPEC
  - DOC-DECISIONS
  - DOC-PUZZLE-FILE
  - DOC-DATASTORE
  - DOC-COMPILATION-FLOW
---

End-to-end app-building guide, worked against the in-repo [[DOC-BLOG-EXAMPLE]] reference app: project structure (app/ source, dist/ output), app entry, models with builders, views/components, event handling, and the two data() gotchas. Every example is valid JS per [[DOC-SPEC]] §4.

# Puzzle User Guide

Complete guide to building applications with the Puzzle Framework - from project structure to deployment.

---

## Quick Start

> **`puzzle init` scaffolds a new app today** (v1.4, D32 — see [[DOC-SPEC]] §13):
> `puzzle init my-app --template default` (or `--template todos`). The
> `npx @magic-spells/create-puzzle-app` wrapper shown below is a thin convenience
> over it and is **not yet published to npm** — until it is, use `puzzle init`,
> or work inside an in-repo reference app (`examples/todos/` or `examples/blog/`)
> and run `puzzle dev`.

```bash
npx @magic-spells/create-puzzle-app my-app
cd my-app
npm run dev
```

---

## Project Structure

The worked example throughout this guide is **`examples/blog/`** ("Puzzle Press"),
one of the two in-repo v1 reference apps. It has this structure:

```
examples/blog/
├── package.json              # Dependencies & scripts
└── app/                      # Application source
    ├── app.js                # App init, formatters, post-mount store seeding
    ├── routes.js             # Route definitions
    ├── models/               # Data models
    │   ├── index.js          # Model registry
    │   ├── user.js           # User model + adapter endpoint
    │   ├── post.js           # Post model + adapter endpoint
    │   └── comment.js        # Comment model (no adapter)
    ├── views/                # Page components (.pzl files)
    │   ├── Home.pzl          # Home page
    │   ├── Posts.pzl         # All-posts page (tag filter)
    │   ├── PostDetail.pzl    # Single post + comments (/posts/:id)
    │   ├── About.pzl         # About page
    │   └── NotFound.pzl      # '*' catch-all page
    ├── components/           # Reusable UI components (.pzl files)
    │   ├── Button.pzl        # Button (props + <children/> + callback prop)
    │   ├── PostCard.pzl      # Post summary card
    │   └── CommentItem.pzl   # Single comment row
    ├── layouts/              # Layout components (.pzl files)
    │   └── Default.pzl       # Default layout (nav + <Slot/> + footer + base styles)
    └── public/               # Static assets & HTML
        ├── index.html        # Main HTML file
        └── api/              # Static JSON seeds for store.loadAll
            ├── users.json
            └── posts.json
# dist/ (build output from `puzzle build`) is generated and git-ignored
```

Styling here is done with per-file `<styles>` blocks — no `puzzle.config.js`, no
Tailwind. The companion `examples/todos/` shows the Tailwind pipeline instead.

## File Organization

### .pzl Files (UI Components)
- **Views** - Page components that represent routes (`/views/*.pzl`)
- **Components** - Reusable UI components (`/components/**/*.pzl`)
- **Layouts** - Wrapper components for pages (`/layouts/*.pzl`)

### .js Files (Application Logic)
- **App.js** - Main application initialization and configuration
- **Routes.js** - Route definitions and navigation logic
- **Models** - Data models with schema, computed properties, and validation rules (`/models/*.js`)

### Importing with `@` (v1.42, D75)

`@` is a built-in alias for your `app/` directory, so an import can name a file
by where it lives in the project instead of by how many directories up it is:

```js
import ChirpCard from '@/components/ChirpCard.pzl';   // app/components/ChirpCard.pzl
import User from '@/models/user.js';                   // app/models/user.js
```

It works from any depth and in any bundled file — `.pzl` `<scripts>` blocks,
`app.js`, `routes.js`, models — which makes it worth reaching for once views
live in subfolders and relative imports start climbing `../../`. Relative
imports keep working exactly as before; the two spellings mix freely.

`@` is always on and needs no configuration. `puzzle init` also writes the
matching `paths` entry into `jsconfig.json` (or `tsconfig.json` with
`--typescript`) so editors resolve `@/…` for go-to-definition; an existing app
adds it by hand:

```json
{ "compilerOptions": { "paths": { "@/*": ["./app/*"] } } }
```

Note the alias is for **module imports only** — `{#svg '…'}` paths are already
resolved against `app/assets/`, and CSS `@import`s are unaffected.

---

## App Entry Point

### app/app.js
```javascript
import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';
import models from './models/index.js';

// Create and configure the Puzzle app.
// The v1 config surface is intentionally small: target, routes, models,
// formatters, apiURL — see [[DOC-SPEC]] §2.
const app = new PuzzleApp({
  // Where the app mounts
  target: '#app',

  // Routes configuration
  routes,

  // Models registration
  models,

  // Base URL for the D21 server read path. Adapter endpoints are joined onto
  // this, so store.loadAll('post') fetches /api/posts.json — a static JSON seed
  // copied from app/public/api/ into dist/api/ at build time.
  apiURL: '/api',

  // Global formatters available in all templates
  // (display transformation only — logic belongs in data())
  formatters: {
    byline: (name) => (name ? `By ${name}` : 'By an unknown author')
  },

  // Seed the store from the server (D21 read path) before navigation #0 runs
  // (v1.31 app lifecycle hook, SPEC §34). loadAll upserts by primary key and
  // notifies subscribers, so it must NEVER run inside data() — a view
  // subscribed to that type would refetch forever. Fire it once, here.
  beforeMount(app) {
    app.store.loadAll('user').catch((err) => console.error('[blog] user seed failed:', err));
    app.store.loadAll('post').catch((err) => console.error('[blog] post seed failed:', err));
  }
});

app.mount();

export default app;
```

The v1 config surface is `target`, `routes`, `models`, `formatters`, and `apiURL`, plus the optional amendments (`scrollBehavior`, `routerMode`, the v1.31 lifecycle hooks `beforeMount`/`mounted`/`beforeUnmount`, …) — see [[DOC-SPEC]] §2 and §34. Seeding the store with `store.loadAll` in `beforeMount` is the D21 read path; see [Two data() gotchas](#two-data-gotchas) for why it must never run inside `data()`.

### app/routes.js
```javascript
import HomeView from './views/Home.pzl';
import PostsView from './views/Posts.pzl';
import PostDetailView from './views/PostDetail.pzl';
import AboutView from './views/About.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'home',
    view: HomeView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Press'
    }
  },
  {
    path: '/posts',
    name: 'posts',
    view: PostsView,
    layout: DefaultLayout,
    meta: {
      title: 'All Posts · Puzzle Press'
    }
  },
  {
    path: '/posts/:id',
    name: 'post',
    view: PostDetailView,
    layout: DefaultLayout,
    meta: {
      title: 'Post · Puzzle Press'
    }
  },
  {
    path: '/about',
    name: 'about',
    view: AboutView,
    layout: DefaultLayout,
    meta: {
      title: 'About · Puzzle Press'
    }
  },
  {
    path: '*',
    name: 'not-found',
    view: NotFoundView,
    layout: DefaultLayout,
    meta: {
      title: 'Not Found · Puzzle Press'
    }
  }
];
```

A `:id` segment (`/posts/:id`) lands in `params` for the view's `data(params, props)`; the `'*'` catch-all is always matched last and renders the 404 view (D19).

---

## Data Models

Models define your data structure with `Puzzle` schema field builders, plus computed properties and validation rules:

### models/user.js
```javascript
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class User extends PuzzleModel {
  // Schema definition — see [[DOC-SPEC]] §7. String ids so the server-seeded
  // records (loadAll) upsert stably by primary key.
  static schema = {
    id:       Puzzle.string().primary(),
    name:     Puzzle.string().required(),
    email:    Puzzle.string(),
    role:     Puzzle.string().default('author'),
    bio:      Puzzle.string().default(''),
    joinedAt: Puzzle.date()
  };

  // Computed properties — plain getters ([[DOC-SPEC]] §7).
  // loadAll-seeded dates arrive as ISO strings, so coerce defensively.
  get initials() {
    return String(this.name)
      .trim()
      .split(/\s+/)
      .map((part) => part.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  get memberSince() {
    return new Date(this.joinedAt);
  }

  // Server location (D21): consumed by store.loadAll('user') on the read path,
  // and by record.save()/delete() for write sync (v1.18, D50).
  static adapter = {
    endpoint: '/users.json'
  };
}
```

### models/post.js
```javascript
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Post extends PuzzleModel {
  // Schema definition — see [[DOC-SPEC]] §7. authorId cross-references a User;
  // tags is an array that defaults to empty so a partial record still renders.
  static schema = {
    id:          Puzzle.string().primary(),
    title:       Puzzle.string().required(),
    body:        Puzzle.string().required(),
    authorId:    Puzzle.string(),
    tags:        Puzzle.array().default(() => []),
    publishedAt: Puzzle.date()
  };

  // Computed properties — plain getters ([[DOC-SPEC]] §7).
  // loadAll-seeded dates arrive as ISO strings, so coerce defensively.
  get publishedDate() {
    return new Date(this.publishedAt);
  }

  get excerpt() {
    const text = String(this.body);
    return text.length > 160 ? text.slice(0, 160).trimEnd() + '…' : text;
  }

  get readingTime() {
    const words = String(this.body).trim().split(/\s+/).length;
    return Math.max(1, Math.round(words / 200));
  }

  // Server location (D21): consumed by store.loadAll('post') on the read path.
  static adapter = {
    endpoint: '/posts.json'
  };
}
```

### models/comment.js
```javascript
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Comment extends PuzzleModel {
  // Comments are created in the browser (createRecord), never seeded, so this
  // model declares NO adapter — the server read path (loadAll) is opt-in per model.
  static schema = {
    id:        Puzzle.string().primary(),
    postId:    Puzzle.string(),
    author:    Puzzle.string().default('Anonymous'),
    text:      Puzzle.string().required(),
    createdAt: Puzzle.date().default(() => new Date())
  };
}
```

### models/index.js
```javascript
import User from './user.js';
import Post from './post.js';
import Comment from './comment.js';

export const models = {
  user: User,
  post: Post,
  comment: Comment
};

export default models;
```

**The `adapter` drives both the read and write paths.** A model's `static adapter = { endpoint }` is consumed on the read path by `store.loadAll(type)` / `store.loadOne(type, id)`, which GET `apiURL + endpoint` and upsert the results (D21). A model with no `adapter` (like `comment` above) simply opts out of that path. Write sync shipped in v1.18 (D50): `record.save()` POSTs a never-synced record and PUTs a synced one (local-first — a failed save keeps the dirty state and rejects), `record.delete()` DELETEs then removes locally, and `store.request()` reaches custom endpoints; `record.destroy()` stays local-only. Validation enforces too — since v1.16 (D48) `createRecord`/`update` throw `PuzzleValidationError` on invalid data, while `Model.validate(data)` / `record.validate()` return `{ valid, errors }` without throwing for form UX (server upserts and storage hydration stay exempt). See [[DOC-SPEC]] §20/§22 and [[DOC-DECISIONS]] D21/D48/D50.

---

## Building Views

Views are page components that load and display data. The pattern is simple:

### views/Home.pzl
```html
<puzzle-view class="home">
  <section class="hero">
    <h1 class="hero__title">Notes on building Puzzle</h1>
    <p class="hero__lead">
      A running blog about the framework itself — single-file components, the Go
      compiler, the formatter system, and the reactive data layer.
    </p>
    <Button variant="primary" @press={ goToPosts }>Browse all posts</Button>
  </section>

  <section class="home-latest">
    <h2 class="home-latest__title">Latest posts</h2>

    {#if hasPosts}
      <div class="post-list">
        {#for post in recentPosts}
          <PostCard post={ post }></PostCard>
        {/for}
      </div>
    {:else}
      <div class="empty">
        <p>Posts are loading…</p>
      </div>
    {/if}
  </section>
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
import Button from '../components/Button.pzl';
import PostCard from '../components/PostCard.pzl';

export default class HomeView extends PuzzleView {
  // data() reads the store and derives the three newest posts. The store starts
  // empty and is seeded after mount (see app.js); when the seed lands, the
  // 'post' subscription re-runs data() and the list fills in.
  data(params, props) {
    const posts = this.ctx.store.findMany('post');
    const recentPosts = [...posts]
      .sort((a, b) => b.publishedDate - a.publishedDate)
      .slice(0, 3);

    return {
      recentPosts,
      hasPosts: posts.length > 0
    };
  }

  events = {
    goToPosts: () => {
      this.ctx.router.push('/posts');
    }
  };
}
</scripts>

<styles>
.hero {
  text-align: center;
  padding: 1.5rem 0 2.5rem;
}

.hero__title {
  margin: 0 0 0.75rem;
  font-size: 2.25rem;
  color: #1f2933;
}

.hero__lead {
  max-width: 34rem;
  margin: 0 auto 1.5rem;
  color: #52606d;
  font-size: 1.05rem;
}

.home-latest__title {
  font-size: 1.35rem;
  color: #1f2933;
  margin: 0 0 1rem;
}

.post-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.empty {
  padding: 2rem;
  text-align: center;
  color: #7b8794;
  background: #fff;
  border: 1px dashed #cbd2d9;
  border-radius: 12px;
}
</styles>
```

`@press` on the `<Button>` tag is a **callback prop** (D16): the compiler hands the child a function on `this.props.press`, and the child's own `@click` handler invokes it. `<PostCard>` renders each summary as a real `<a href>` that the router intercepts for SPA navigation.

### views/PostDetail.pzl

This is the view for the `/posts/:id` route. It reads `params.id`, joins the post
to its author and comments, and hosts a comment form. Views receive **only route
params and props** in `data(params, props)` — the router does not inject a
"current user" or any other ambient value; props flow strictly parent → child.

```html
<puzzle-view class="detail">
  {#if post}
    <article class="post">
      <div class="post__tags">
        {#for tag in post.tags}
          <span class="post__tag">{ tag }</span>
        {/for}
      </div>
      <h1 class="post__title">{ post.title }</h1>
      <div class="post__meta">
        {#if author}
          <span class="post__author">{ author.name | byline }</span>
          <span class="post__dot">·</span>
        {/if}
        <span>{ post.publishedAt | date('long') }</span>
        <span class="post__dot">·</span>
        <span>{ post.readingTime } min read</span>
      </div>
      <p class="post__body">{ post.body }</p>
    </article>

    <section class="comments">
      <h2 class="comments__title">
        { comments.length } { comments.length | pluralize('comment', 'comments') }
      </h2>

      {#if comments.length > 0}
        <ul class="comment-list">
          {#for comment in comments}
            <CommentItem comment={ comment } @remove={ removeComment(comment) }></CommentItem>
          {/for}
        </ul>
      {:else}
        <p class="comments__empty">Be the first to comment.</p>
      {/if}

      <form class="comment-form" @submit={ addComment(event) }>
        <input
          class="comment-form__name"
          type="text"
          placeholder="Your name"
          value={ authorName }
          @input={ updateAuthorName(event) } />
        <textarea
          class="comment-form__text"
          placeholder="Write a comment…"
          value={ commentText }
          @input={ updateCommentText(event) }></textarea>
        <button class="btn btn--primary" type="submit" disabled={ !commentText.trim() }>
          Add comment
        </button>
      </form>
    </section>
  {:else}
    {#if loaded}
      <div class="empty">
        <h1 class="empty__title">Post not found</h1>
        <p>That post does not exist. <a href="/posts">Back to all posts</a>.</p>
      </div>
    {:else}
      <div class="empty">
        <p>Loading post…</p>
      </div>
    {/if}
  {/if}
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';
import CommentItem from '../components/CommentItem.pzl';

export default class PostDetailView extends PuzzleView {
  created() {
    // Local form state — seeded here so data() can read it back on first run.
    this.setData({
      commentText: '',
      authorName: ''
    });
  }

  data(params, props) {
    const store = this.ctx.store;
    const local = this.getData();

    const allPosts = store.findMany('post');
    const post = store.findOne('post', params.id);
    const author = post ? store.findOne('user', post.authorId) : null;
    const comments = store
      .findMany('comment', { filter: (comment) => comment.postId === params.id })
      .sort((a, b) => a.createdAt - b.createdAt);

    return {
      post,
      author,
      comments,
      // Distinguish "still loading" from a genuine miss: once any post has been
      // seeded, a null lookup means the id really does not exist.
      loaded: allPosts.length > 0,
      commentText: local.commentText,
      authorName: local.authorName
    };
  }

  events = {
    updateAuthorName: (event) => {
      this.setData('authorName', event.target.value);
    },

    updateCommentText: (event) => {
      this.setData('commentText', event.target.value);
    },

    addComment: (event) => {
      event.preventDefault();
      const { commentText, authorName } = this.getData();
      const text = commentText.trim();
      if (!text) return;

      this.ctx.store.createRecord('comment', {
        postId: this.params.id,
        author: authorName.trim() || 'Anonymous',
        text
      });

      this.setData({ commentText: '', authorName: '' });
    },

    removeComment: (comment) => {
      comment.destroy();
    }
  };
}
</scripts>

<styles>
.post__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.post__tag {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #4c6ef5;
  background: #eef2ff;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
}

.post__title {
  margin: 0 0 0.6rem;
  font-size: 2rem;
  color: #1f2933;
}

.post__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  color: #7b8794;
  font-size: 0.85rem;
  margin-bottom: 1.5rem;
}

.post__body {
  font-size: 1.08rem;
  color: #3e4c59;
}

.comment-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background: #fff;
  border: 1px solid #e4e9f0;
  border-radius: 12px;
  padding: 1.25rem;
}

.empty {
  padding: 2.5rem;
  text-align: center;
  color: #7b8794;
  background: #fff;
  border: 1px dashed #cbd2d9;
  border-radius: 12px;
}
</styles>
```

Notes on this view:
- **`params.id`** comes from the `/posts/:id` route; `data()` re-runs when it changes.
- The comment form uses one-way `value={ … }` bindings plus manual `@input` handlers that `setData` local state, then `createRecord('comment', …)` on submit.
- `<CommentItem @remove={ removeComment(comment) }>` is a **callback prop** carrying the loop variable; the child reports intent and the **parent owns the mutation** (`comment.destroy()`).
- The nested conditional shown (`{#if post}…{:else}{#if loaded}…{/if}{/if}`) predates v1.9 — since `{:else if}` chaining shipped (D40) you can flatten it to `{#if post}…{:else if loaded}…{:else}…{/if}`.
- The `<styles>` block above is abridged and is a standalone walkthrough of the `<styles>` feature — the shipped `examples/blog/app/views/PostDetail.pzl` now styles this view with Tailwind instead (see [[DOC-DECISIONS]] D27), so this section no longer mirrors that file verbatim.

---

## Building Components

Reusable components render **inline** (D20): their `<puzzle-view>` carries **no
attributes** and wraps a **single root element** — attributes on a component's
`<puzzle-view>` are a compile error. Put them on your root element instead. Class
names are prefixed (`.btn`, `.post-card`, …) so the global stylesheet stays tidy.

### components/Button.pzl
```html
<puzzle-view>
  <button class="btn btn--{ variant }" type={ type } disabled={ disabled } @click={ handleClick }>
    <children/>
  </button>
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';

// A reusable button. Component-mode files render inline, so <puzzle-view> is
// just the template delimiter — it carries no attributes and wraps a single
// root element (D20). Label content is projected through <children/>.
export default class Button extends PuzzleView {
  data(params, props) {
    return {
      variant: props.variant || 'primary',
      type: props.type || 'button',
      disabled: props.disabled || false
    };
  }

  // `press` is a callback prop: the parent passes @press={ handler } and the
  // compiler hands the child a function on this.props.press (D16).
  events = {
    handleClick: (event) => {
      if (this.getData().disabled) return;
      const { press } = this.props;
      if (typeof press === 'function') press(event);
    }
  };
}
</scripts>

<styles>
.btn {
  display: inline-block;
  padding: 0.6rem 1.25rem;
  border: 0;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary {
  background: #4c6ef5;
  color: #fff;
}

.btn--primary:hover:not(:disabled) {
  background: #3b5bdb;
}

.btn--ghost {
  background: transparent;
  color: #4c6ef5;
  box-shadow: inset 0 0 0 1px #c3cfe6;
}

.btn--ghost:hover:not(:disabled) {
  background: #eef2ff;
}
</styles>
```

Key points: the `<button>` (not `<puzzle-view>`) carries the attributes; the label
is projected through **`<children/>`** (the default marker, D16/D74 — the same
primitive layouts spell `<Slot/>` as the router outlet); and `@click` here is a **real DOM listener**
on the child's own `<button>`. The `press` callback prop is guarded before it's
called — `this.$emit` does not exist in v1.

### components/PostCard.pzl
```html
<puzzle-view>
  <a class="post-card" href="/posts/{ post.id }">
    <div class="post-card__tags">
      {#for tag in post.tags}
        <span class="post-card__tag">{ tag }</span>
      {/for}
    </div>
    <h3 class="post-card__title">{ post.title }</h3>
    <p class="post-card__excerpt">{ post.body | truncate(140) }</p>
    <div class="post-card__meta">
      <span>{ post.readingTime } min read</span>
      <span class="post-card__dot">·</span>
      <span>{ post.publishedAt | timeago }</span>
    </div>
  </a>
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';

// Renders a single post summary. The whole card is an <a>, so a plain click is
// intercepted by the router for instant SPA navigation to /posts/:id.
export default class PostCard extends PuzzleView {
  data(params, props) {
    return {
      post: props.post
    };
  }
}
</scripts>

<styles>
.post-card {
  display: block;
  padding: 1.25rem 1.5rem;
  background: #fff;
  border: 1px solid #e4e9f0;
  border-radius: 12px;
  color: inherit;
}
</styles>
```

`PostCard` takes an **object prop** (`post={ post }`) and renders a real
`<a href="/posts/{ post.id }">`; the router intercepts the click for SPA
navigation. The `<styles>` block is abridged here to illustrate the feature;
the shipped `examples/blog/app/components/PostCard.pzl` now uses Tailwind
utilities instead (see [[DOC-DECISIONS]] D27).

### components/CommentItem.pzl
```html
<puzzle-view>
  <li class="comment-item">
    <div class="comment-item__head">
      <span class="comment-item__author">{ comment.author }</span>
      <span class="comment-item__time">{ comment.createdAt | timeago }</span>
    </div>
    <p class="comment-item__text">{ comment.text }</p>
    <button class="comment-item__remove" type="button" @click={ handleRemove }>Delete</button>
  </li>
</puzzle-view>

<scripts>
import { PuzzleView } from '@magic-spells/puzzle';

// A single comment. The mutation is parent-owned: this component only reports
// intent through the @remove callback prop, and the parent decides what to do.
export default class CommentItem extends PuzzleView {
  data(params, props) {
    return {
      comment: props.comment
    };
  }

  events = {
    handleRemove: (event) => {
      const { remove } = this.props;
      if (typeof remove === 'function') remove(event);
    }
  };
}
</scripts>
```

`CommentItem`'s `<button>` fires a DOM `@click`, which invokes the `remove`
callback prop the parent passed as `@remove={ removeComment(comment) }`. The child
never mutates the record itself — that's the parent-owned-mutation pattern.

---

## Key Patterns

### Data Loading Pattern
```javascript
data(params, props) {
  const store = this.ctx.store;

  return {
    user: store.findOne('user', params.id),  // Single record by id
    posts: store.findMany('post'),           // All posts
    loading: false                           // Local state
  };
}
```

**The `data()` method:**
- Runs on component mount and when subscribed store data changes
- Supports async/await for fetching data
- Auto-subscribes to any store queries
- Returns the component's model/state object

### Two data() gotchas

**Never call `store.loadAll` (or `loadOne`) inside `data()`.** `loadAll` upserts
records and notifies subscribers on *every* call, so a view subscribed to that
type would re-run `data()`, refetch, notify, and loop forever. Seed the store
**once**, in the app's `beforeMount` hook (v1.31, SPEC §34 — it runs before the
first navigation, so an awaited seed is visible to the first `data()`):

```javascript
// app.js — seed once in beforeMount, never inside a view's data()
const app = new PuzzleApp({
  // …target, routes, models…
  async beforeMount(app) {
    await Promise.all([app.store.loadAll('user'), app.store.loadAll('post')]);
  }
});
app.mount();
```

**Derived lists computed in `data()` need `setData(...)` + `this.refresh()` (D23).**
`setData()` updates local state but does *not* re-run `data()`, so a list derived
from that local state won't recompute on its own. Call `this.refresh()` to re-run
`data()` explicitly:

```javascript
// From Posts.pzl — the tag filter is derived in data() from local activeTag
events = {
  setTag: (tag) => {
    this.setData('activeTag', tag);  // local UI state — does not re-run data()
    this.refresh();                   // re-run data() so the filtered list updates
  }
};
```

### Object props: keep references stable with `this.memo()` (v1.29, D64)

Props are compared with a shallow `===` check, so an **object or array prop compares by reference** — and inline object literals are a compile error in templates, so these props are always built in `data()`. If `data()` builds a *fresh* object on every run, the child sees a "changed" prop on every unrelated store change and re-runs its own `data()` (and a wrapper component may push spurious updates into whatever it wraps). Wrap derived objects in `this.memo(key, deps, factory)` — the same reference comes back until a dependency actually changes:

```javascript
data(params, props) {
  const { effect = 'carousel' } = this.getData();
  return {
    // Same object reference until `effect` changes — the child's data()
    // only re-runs on a real options change.
    carouselOptions: this.memo('opts', [effect], () => ({
      effect,
      loop: true,
      slidesPerView: 2,
    })),
  };
}
```

`deps` is an array compared positionally by `Object.is`; when any entry differs, the factory runs once and the new value is cached. It's purely about identity — no reactivity of its own. (Plain string/number/boolean props don't need this; `===` already does the right thing. Callback props don't either — since v1.29 data-independent handlers are automatically cached by the compiler, see [[DOC-EVENTS]], which also documents the `@ready` callback-ref idiom for reaching a child's imperative API.)

### Event Handling Pattern

`events` is a class field of arrow functions. A bare identifier in the template (`@click={ handleClick }`) receives the DOM `event`; a call expression (`@submit={ handleSubmit(formData) }`) passes exactly the arguments written, evaluated at event time with `event` in scope.

```javascript
events = {
  handleClick: (event) => {
    // Bare identifier in template: @click={ handleClick }
    this.ctx.router.push('/somewhere');
  },

  handleSubmit: (formData) => {
    // Call expression in template: @submit={ handleSubmit(formData) }
    const store = this.ctx.store;
    store.createRecord('post', formData);
  }
};
```

### Template Patterns
```html
<!-- Conditionals -->
{#if user.isLoggedIn}
  <p>Welcome, { user.name }!</p>
{:else}
  <p>Please log in</p>
{/if}

<!-- Loops -->
{#for post in posts}
  <div>{ post.title }</div>
{/for}

<!-- Formatters -->
{ user.name | capitalize }
{ post.publishedAt | timeago }
{ price | currency('$', 2) }

<!-- Callback prop on a component tag (D16) -->
<Button @press={ handleClick } variant="primary">
  Click me
</Button>
```

### Animations (v1.1)

Add an `animations` class field to any view, layout, or component to animate it in and out via the Web Animations API. Each of `in`/`out` is `{ from, to, duration, easing?, delay? }` — WAAPI keyframes plus timing. The animation target is the instance's root element (no wrapper is added), so the `to` keyframe must equal the element's natural resting style — the enter animation's inline styles are released once it finishes.

```js
// components/TodoItem.pzl
export default class TodoItem extends PuzzleView {
  animations = {
    in:  { from: { height: '0px', opacity: 0, transform: 'scale(0.96)' },
           to:   { height: '44px', opacity: 1, transform: 'scale(1)' },
           duration: 200, easing: 'ease-out' },
    out: { from: { opacity: 1 }, to: { opacity: 0 }, duration: 150 },
  };
}
```

Notes:

- Height can't animate to `auto` under WAAPI — animate between explicit `px` values (here the row wraps its content in a fixed 44px inner element).
- Views animate on route transitions: the old view plays `out`, then the new view plays `in` (sequential). Components animate when added to / removed from a list.
- Four optional lifecycle hooks bracket the phases — `viewWillShow()`/`viewDidShow()` around the enter, `viewWillHide()`/`viewDidHide()` around the leave — and fire even when no `animations` field is declared.
- `prefers-reduced-motion: reduce` zeroes all durations automatically. A malformed spec warns once and is skipped.

### Scroll-triggered reveals (v1.40)

By default the `in` animation plays the moment the component mounts — which means below-the-fold sections on a long page animate before anyone sees them. Add `trigger: 'visible'` to the `in` spec and the enter instead **waits until the element scrolls into the viewport**: the element mounts held at its `from` keyframe (no flash), then plays once when it comes into view.

```js
// components/FeatureSection.pzl
export default class FeatureSection extends PuzzleView {
  animations = {
    in: {
      from: { opacity: 0, transform: 'translateY(24px)' },
      to:   { opacity: 1, transform: 'translateY(0)' },
      duration: 500, easing: 'ease-out',
      trigger: 'visible',
      triggerOffset: '15%', // optional: fire when the element is 15% above the viewport bottom
    },
  };
}
```

Notes:

- `triggerOffset` is a px number or a `'%'` string — the distance of the trigger line above the bottom edge of the viewport. Omit it to fire as soon as any part of the element is visible.
- The reveal plays **once per mount** — scrolling away and back does not replay it. `viewWillShow()`/`viewDidShow()` fire around the actual reveal; `mounted()` still fires at mount.
- Give consecutive sections their own components and they stagger naturally — each reveals as it crosses the trigger line ( `delay` also still applies per spec).
- **Group reveals:** add `triggerAnchor: '.feature-section'` (a CSS selector matched against the component's **ancestors**) and the component reveals when that ancestor scrolls into view instead of its own root — so a heading and three cards anchored to the same section fire together the moment the *section* crosses the line, with each child's `delay` providing the choreography. No match falls back to the component's own root (and warns once).
- It degrades safely: browsers without `IntersectionObserver` and users with `prefers-reduced-motion` get the content immediately (no hold), exactly like `trigger: 'mount'`.
- Use the default mount trigger for hero/above-the-fold content — a `'visible'` hold on content that is already on screen just delays it by a frame.

---

## Backends in dev

Point a same-origin path at a local backend in `puzzle.config.js`:

```javascript
export default {
  dev: {
    proxy: { '/api': 'http://localhost:3091' },
  },
};
```

`puzzle dev` now forwards `/api` and `/api/*` requests to that backend with the
path unchanged. The app can use `apiURL: ''`, so development requests stay
same-origin and need no CORS setup. Restart the dev server after changing the
proxy config; production builds are unaffected.

---

## Development Commands

```bash
# Development server with watch + live reload
npm run dev

# Production build
npm run build
```

---

## Next Steps

- Read [[DOC-SPEC]] for the frozen v1 specification
- Read [[DOC-PUZZLE-FILE]] for complete component reference
- Read [[DOC-DATASTORE]] for data management details
- Read [[DOC-COMPILATION-FLOW]] for build process info

---

This structure gives you a **complete, production-ready application template** with clear separation between UI components (`.pzl`) and application logic (`.js`)! 🎯
