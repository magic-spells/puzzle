# Puzzle Press Example

A small blog built with the Puzzle framework. Where `examples/todos/` is the
canonical single-view app styled with Tailwind, this example is the second v1
reference app: it leans into the features todos does not cover — multiple
models, route params and a catch-all, reusable components with props and
callbacks, auto-fetching server data, custom formatters — and it styles itself with
plain per-file `<style>` blocks instead of Tailwind (no `puzzle.config.js`, no
build-time CSS pipeline).

## What each file demonstrates

### App wiring
- **app/app.js** — `PuzzleApp` config (`target`, `routes`, `models`,
  `formatters`, `apiURL`), the `adapter` capability, and a custom `byline`
  formatter. There is no seeding step and no loading code anywhere in the app.
- **app/routes.js** — five routes including a dynamic segment (`/posts/:id`) and
  the `*` catch-all, each with a `layout` and `meta.title`.

### Models (`app/models/`)
- **user.js** — string ids, `initials`/`memberSince` getters, adapter endpoint
  `/users.json` plus a custom `loadOne`.
- **post.js** — `title`/`body`/`authorId`/`tags`/`publishedAt`, `excerpt`,
  `readingTime`, and a defensive `publishedDate` getter; adapter endpoint
  `/posts.json` plus a custom `loadOne`.
- **comment.js** — created in the browser, so it declares **no adapter** (the
  server read path is opt-in per model). Finds on `comment` never fetch.
- **index.js** — the `{ user, post, comment }` registry.

### Views (`app/views/`)
- **Home.pzl** — hero, a `<Button @press>` that navigates, and the three newest
  posts via `<PostCard>` with an `{#if}/{:else}` empty state.
- **Posts.pzl** — tag-filter tabs using `findMany({ filter })` plus the
  `setData` + `this.refresh()` derived-list pattern; `pluralize` formatter.
  Also the **`flip` showcase (v1.51, puzzle ≥ 0.2.0)**: the sort control
  (Newest / Oldest / A–Z) reorders the keyed post list, and the bare `flip`
  attribute on the `<PostCard>` row root makes every retained card slide to its
  new position (options ride an object from `data()` — `flip={ flipOpts }` —
  never an inline literal). Fresh cards keep PostCard's staggered enter and
  filtered-out cards its leave animation; only *moves* are FLIP-animated. The
  stylesheet's `puzzle-view { display: block }` rule is load-bearing here:
  transforms don't apply to inline boxes.
- **PostDetail.pzl** — the auto-fetch showcase: `findOne('post', params.id)` and
  a second find on `post.authorId`, deep-linkable into an empty store with no
  loading flag in sight; the post's comments; a comment form (one-way `value={}`
  + manual `@input`, then `createRecord`); `<CommentItem @remove={
  removeComment(comment) }>`; `byline`/`date`/`timeago` formatters.
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
- **Default.pzl** — nav + `<Slot/>` + footer, and the base `<style>` block for
  the whole app.

## How server data gets here

The store starts empty and nothing in this app fills it. Server data lives as
static JSON under `app/public/api/` (`users.json`, `posts.json`), which the
build copies verbatim into `dist/api/`, and every view gets it the same way:

**Server data comes from `data()`. `findOne` and `findMany` fetch what the
store is missing. A committed `null` means the record does not exist.**

That is the whole rule. `PostDetail.pzl` is the clearest case — this is the
complete data layer for a deep-linkable `/posts/:id` page:

```js
data(params) {
  const store = this.ctx.store;
  const post = store.findOne('post', params.id);
  const author = post ? store.findOne('user', post.authorId) : null;
  return { post, author, comments: post ? [...post.comments] : [] };
}
```

Land on `/posts/3` in a cold tab and the store has neither record. The finds
still read like plain synchronous code because the view does not commit the
first pass: a tracked miss returns `null` and queues a fetch, and Puzzle re-runs
`data()` behind the batch until a pass comes back with every read warm (D161).
Here that takes three rounds — miss the post, get the post and miss the author,
get both — and the template renders once, fully populated. Nothing declares that
the author depends on the post; the loop discovers it.

Three consequences worth internalizing:

1. **`null` is never "still loading."** `{#if post} … {:else} Post not found`
   needs no companion `loaded` flag, because the view is only mounted once its
   reads settled. A 404 from the server is what produces that `null`.
2. **Relationships never fetch.** `post.author` is a local lookup by design — a
   50-row list must not become 50 GETs. When a view genuinely needs a related
   record it asks for it, which is why `PostDetail` finds the user by
   `post.authorId` instead of leaning on `post.author` alone. Once the user is
   in the store, both spellings resolve.
3. **Event handlers read local state only.** Reads outside a tracked `data()`
   run never fetch. A handler that needs fresh server data changes state and
   calls `this.refresh()`, which re-enters the settle loop.

### Mapping a per-record read onto a static file

The generated REST defaults would GET `apiURL + endpoint + '/' + id` for a
single record — `/api/posts.json/3` — and this demo's "server" is one static
file per collection, so there is no such URL. A model can replace any single
adapter verb with its own fetch function, so `post.js` maps `loadOne` onto the
collection file:

```js
static adapter = {
  endpoint: '/posts.json',

  async loadOne(fetch, id) {
    const res = await fetch('/api/posts.json');
    if (!res.ok) return res;
    const posts = await res.json();
    return (
      posts.find((post) => String(post.id) === String(id)) ??
      new Response(null, { status: 404 })
    );
  }
};
```

Returning a non-OK `Response` is the supported way to report "not there": the
framework normalizes it into a `PuzzleAdapterError`, and a 404 on the auto-fetch
path becomes the committed `null` the template branches on. Anything else — a
network failure, a 500, a malformed body — fails the navigation instead of
quietly rendering an empty page. `findMany` needs no such treatment; the
generated collection GET already lands on `/api/posts.json`.

Requests are deduplicated and cached for the session: once a successful
`findMany('post')` has run, the type is complete and later finds are pure local
reads, so browsing from `/posts` into a post issues no request at all.

### Dates arrive as ISO strings

The model constructor is a plain `Object.assign`, so a JSON `publishedAt` stays
a string. Getters coerce defensively (`new Date(this.publishedAt)`), and the
`date`/`timeago` formatters already do the same.

## Running the example

```bash
cd examples/blog
npm install
npm run dev
```

Open http://localhost:3000 to see the app.
