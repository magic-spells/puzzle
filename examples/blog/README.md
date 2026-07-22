# Puzzle Press Example

A small blog built with the Puzzle framework. Where `examples/todos/` is the
canonical single-view app styled with Tailwind, this example is the second v1
reference app: it leans into the features todos does not cover — multiple
models, route params and a catch-all, reusable components with props and
callbacks, network-seeded data, custom formatters — and it styles itself with
plain per-file `<styles>` blocks instead of Tailwind (no `puzzle.config.js`, no
build-time CSS pipeline).

## What each file demonstrates

### App wiring
- **app/app.js** — `PuzzleApp` config (`target`, `routes`, `models`,
  `formatters`, `apiURL`), a custom `byline` formatter, and post-mount seeding of
  the store with `store.loadAll`.
- **app/routes.js** — five routes including a dynamic segment (`/posts/:id`) and
  the `*` catch-all, each with a `layout` and `meta.title`.

### Models (`app/models/`)
- **user.js** — string ids, `initials`/`memberSince` getters, adapter endpoint
  `/users.json`.
- **post.js** — `title`/`body`/`authorId`/`tags`/`publishedAt`, `excerpt`,
  `readingTime`, and a defensive `publishedDate` getter; adapter endpoint
  `/posts.json`.
- **comment.js** — created in the browser, so it declares **no adapter** (the
  server read path is opt-in per model).
- **index.js** — the `{ user, post, comment }` registry.

### Views (`app/views/`)
- **Home.pzl** — hero, a `<Button @press>` that navigates, and the three newest
  posts via `<PostCard>` with an `{#if}/{:else}` empty state.
- **Posts.pzl** — tag-filter tabs using `findMany({ filter })` plus the
  `setData` + `this.refresh()` derived-list pattern; `pluralize` formatter.
- **PostDetail.pzl** — `findOne(params.id)`, the post's author, and its comments;
  a comment form (one-way `value={}` + manual `@input`, then `createRecord`);
  `<CommentItem @remove={ removeComment(comment) }>`; `byline`/`date`/`timeago`
  formatters; nested `{#if}` (no `{:else if}` in v1).
- **About.pzl** — `findMany('user')`, the `capitalize` formatter, and a
  `{#for 1...3}` range loop.
- **NotFound.pzl** — the view rendered by the `*` route.

### Components (`app/components/`)
Reusable components render **inline** (D20): their `<puzzle-view>` carries no
attributes and wraps a single root element, and class names are prefixed to keep
the global stylesheet tidy.
- **Button.pzl** — `variant`/`type`/`disabled` props, a `<Slot/>` for the label,
  and a guarded `@press` callback prop.
- **PostCard.pzl** — an object `post` prop rendered as a real `<a href>` (the
  router intercepts the click); `truncate`/`timeago` formatters.
- **CommentItem.pzl** — an object `comment` prop and a `@remove` callback prop
  (the parent owns the mutation).

### Layout (`app/layouts/`)
- **Default.pzl** — nav + `<Slot/>` + footer, and the base `<styles>` block for
  the whole app.

## The `loadAll` seed pattern

The store starts empty. Seed data lives as static JSON under `app/public/api/`
(`users.json`, `posts.json`), which the build copies verbatim into `dist/api/`.
On boot, `app.js` fetches it:

```js
app.mount().then(() => {
  app.store.loadAll('user').catch((err) => console.error('[blog] user seed failed:', err));
  app.store.loadAll('post').catch((err) => console.error('[blog] post seed failed:', err));
});
```

Two rules make this work:

1. **Never call `loadAll` inside `data()`.** `loadAll` upserts records and
   notifies subscribers; a view subscribed to that type would re-run `data()`,
   refetch, notify again, and loop forever. Seed once, after `mount()`.
2. **Seeded dates arrive as ISO strings.** The model constructor is a plain
   `Object.assign`, so a JSON `publishedAt` stays a string. Getters coerce
   defensively (`new Date(this.publishedAt)`), and the `date`/`timeago`
   formatters already do the same.

`store.loadOne` is intentionally unused here: the dev server's history fallback
serves `index.html` (with a 200) for a `/api/…/id` miss, which would throw when
parsed as JSON. `loadAll` over a real JSON array is the reliable read path.

## Running the example

```bash
cd examples/blog
npm install
npm run dev
```

Open http://localhost:3000 to see the app.
