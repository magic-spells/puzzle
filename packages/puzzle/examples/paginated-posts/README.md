# Paginated posts

A small app for the server-data features in [D193](../../constellation/decision/DECISION-D193-SERVER-QUERIES.md):
paginated queries, invalidation, and save status. There is no backend. The
fixtures mock in `app/fixtures.js` serves 47 posts and 23 comments the way a
REST API would, so run it with fixtures:

```sh
puzzle dev --fixtures
```

## What to look at

- **`/` (`views/PostList.pzl`).** `findMany('post', { query: { page } })` with
  the page in the URL. Each page is fetched once; the previous page stays on
  screen until the next one lands, and going back costs no request.
  `posts.meta` carries the server's `nextPage` and `total`.
- **`/posts/:id` (`views/PostDetail.pzl`).** Publish reads its state from
  `store.syncStatus(post)`: the button says "Publishing…" while the save runs,
  and the server's error shows if it fails (the mock refuses posts 5, 10, 15…).
  A successful publish calls `store.invalidate('post')`, so the list refetches
  its page the next time it is shown.
- **`/comments` (`views/Comments.pzl`).** Cursor "load more": the cursors walked
  so far live in `setState`, each cursor is its own cached query, and a click
  fetches only the new page.

`tests/paginated-posts-example.test.js` runs these same views, compiled, against
the same fixtures.
