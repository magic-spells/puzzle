---
name: Server queries — paginated finds, invalidation, write status
status: built
connections:
  - DECISION-D193-SERVER-QUERIES
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - COMPONENT-FIXTURES
  - DOC-SPEC-DATA
  - DOC-DATASTORE
  - TEST-ADAPTER-SYNC
---

# Server queries

The author-facing shape of [[DECISION-D193-SERVER-QUERIES]] and how it was built. The decision card owns the rules; this card shows them in use and lists what changes where.

## In a view

### A paginated list

```js
// app/views/posts/PostList.pzl (script)
data() {
  // the page lives in the url, so back/forward and links work for free
  const page = Number(this.route.query.page ?? 1);
  const posts = this.ctx.store.findMany('post', { query: { page } });
  return {
    posts,
    page,
    // meta comes from the response; the server decides whether there is more
    hasNext: !!posts.meta?.nextPage,
  };
}
```

A query-only navigation (`?page=3`) re-runs `data()` with the new route query ([[DOC-SPEC-ROUTER]] §44). Page 3's key misses, the settle loop fetches it, and the view commits once it lands, with page 2 still on screen until then. Going back to page 2 reads its cached entry with no request.

### Cursor "load more"

```js
data() {
  // cursors walked so far live in view state; '' means the first page
  const cursors = this.getState().cursors ?? [''];
  // the first page still sends limit: an empty query is no query
  const pages = cursors.map((after) =>
    this.ctx.store.findMany('post', { query: after ? { after, limit: 10 } : { limit: 10 } })
  );
  const last = pages[pages.length - 1];
  return { posts: pages.flat(), nextCursor: last.meta?.nextCursor ?? null };
}

events = {
  loadMore: () => {
    const { cursors = [''] } = this.getState();
    this.setState('cursors', [...cursors, this.getData().nextCursor]);
  },
};
```

Each cursor is its own cached entry, so appending one fetches only the new page. (`setState` on a key `data()` read re-runs `data()` on its own, [[DECISION-D23-REFRESH-PATTERN]].)

### Saving, then invalidating

```js
data() {
  const post = this.ctx.store.findOne('post', this.route.params.id);
  const sync = post && this.ctx.store.syncStatus(post);
  return { post, saving: sync?.pending === 'save', saveError: sync?.error?.message ?? null };
}

events = {
  publish: async () => {
    try {
      await this.getData().post.update({ published: true }).save();
    } catch {
      return; // syncStatus(post).error is already showing it
    }
    // every list that shows posts refetches when next read; nothing fetches now
    this.ctx.store.invalidate('post');
  },
};
```

```html
<button @click={ publish } disabled={ saving }>
  {#if saving}Publishing…{/if}{#if !saving}Publish{/if}
</button>
{#if saveError}<p role="alert">{ saveError }</p>{/if}
```

## In an adapter

Nothing changes for an array-returning endpoint. A server that wraps rows, or a cursor API, returns (or is adapted to) `{ records, meta }`:

```js
// app/app.js — one app-wide dialect for an API that answers { data, meta }
const api = adapter.defaults({
  async loadMany(fetch, query, { endpoint }) {
    const qs = new URLSearchParams(query ?? {}).toString();
    const res = await fetch(endpoint + (qs ? '?' + qs : ''));
    const body = await res.json();
    return { records: body.data, meta: body.meta };
  },
});
```

The mock adapter (`/fixtures`) serves `?page`/`?limit` and an `after` cursor by default, answering `{ records, meta: { page, limit, total, nextPage, nextCursor } }` when a request carries any of those params and the plain array otherwise, so `--fixtures` apps paginate without a handler.

## Build plan

**Runtime (`client-runtime/datastore/adapter.js`, all adapter-side):**
- Read state gains `queries` (LRU `Map` of canonical key → `{ type, query, rows, meta, gen, mark }`), `staleType` (`type → gen`) and `staleRecord` (`identity → gen`).
- `canonicalQuery(type, query)` builds the key and throws on a value that is not a string, finite number, boolean or an array of those.
- `_findManyTracked` routes a query read to a new `_faultQuery` (dedupe on `state.many` under the query key) and returns the entry's rows with `meta`; `_findOneTracked` checks the stale marks on a hit.
- `loadMany` accepts `{ records, meta }`, and with options writes the query entry.
- The adapter overrides `Store.prototype.findMany` only for the `query` branch, so an untracked query read returns cached rows; a no-query call goes straight to core.
- `invalidate()` and `syncStatus()` install on the Store prototype; `saveRecord`/`deleteRecord` run through `_write`, which sets and clears per-record status and notifies; `save()`/`delete()` decorate their promise with `pending`/`error`.
- `serializeReadState`/`hydrateReadState` carry `queries`.

**Core (`client-runtime/datastore/store.js`):** no behavior change. JSDoc for `FindManyOptions.query`, and a development warning when `query` is passed on an adapter-free store (it would be ignored).

**Fixtures (`client-runtime/fixtures/mock.js`):** default pagination for `page`/`limit`/`after`.

**Types:** `types/index.d.ts` (`FindManyOptions.query`, `FindManyResult<T>` with `meta`), `types/adapter.d.ts` (`AdapterLoadManyResult`, `WritePromise<T>` with `pending`/`error`, `SyncStatus`, and `invalidate`/`syncStatus` on the Store), plus the installed-method drift guard.

**Tests (vitest):** canonical keys and their errors; a query read faults once, dedupes across views, keeps server order and `meta`; pages share records with `findOne`; untracked query reads are local; `invalidate` in all three forms marks, notifies and refetches only what a view reads, holding old rows until the settle commit; a stale refetch failure reaches `errorView` and retries; generations keep a pre-invalidate response from clearing staleness; `syncStatus` flips and notifies through queued writes; promise `pending`/`error`; read-state serialization round-trip; mock pagination; LRU eviction. TypeScript fixtures under `tests-types`. An end-to-end test of the example (`tests/paginated-posts-example.test.js`) over its compiled views and fixtures.

**Docs:** [[DOC-SPEC-DATA]] §68 (§8, §22 and §61 point to it), [[DOC-SPEC]] deferred list, [[DOC-DATASTORE]], [[DOC-MODELS]], [[COMPONENT-STORE]], [[COMPONENT-ADAPTER]], [[DOC-RELEASE-SURFACE]], the user guide's data chapter, the agent skill, and a CHANGELOG entry under 0.10.0. D193 and this card flip to `built`.

**Example:** `examples/paginated-posts`: a fixtures-backed post list with page links, a detail view with Publish (pending and error state, then `invalidate`), and a cursor "load more" comments list.

**Verification:** `npx vitest run`, `npm run test:runtime-types`, `npm run test:types`, both Go suites, `puzzle check` and `puzzle build` on the new example and on `blog`/`chirp` (existing adapter users), `measure-size.mjs` before and after, and the puzzle-pieces and puzzle-devtools suites.
