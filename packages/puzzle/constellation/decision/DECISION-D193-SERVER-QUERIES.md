---
name: D192 — Server queries: query keys on findMany, store.invalidate(), and write status
status: proposed
connections:
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D132-CROSS-VERB-WRITE-CHAIN
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D191-SET-STATE-GET-STATE
  - FEATURE-SERVER-QUERIES
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - DOC-SPEC-DATA
---

Tracked `findMany` takes server query params that become part of the cache key, `store.invalidate()` marks server data stale so the views reading it refetch, and every `save()`/`delete()` exposes its pending and error state. All of it lives in the `/adapter` subpath.

## Context

D161 made tracked finds fetch what the store is missing, keyed by model type: a type is either LOADED or not, and a present record is always fresh. That covers a first load. It leaves three gaps that any list screen hits on day one:

1. **No query keys.** `findMany('post')` loads the whole collection once. A paginated endpoint has no way to say "page 2" or "after cursor X" through a tracked read, and the local `findMany` returns every post in the store, not the page the server answered.
2. **No staleness.** After a save that changes what the server would return (a published post moves between lists, a count changes), nothing can tell a loaded type or record to fetch again short of an imperative `loadMany` in a handler, which then has to be wired to every view that reads it.
3. **No write status.** `save()` and `delete()` return a promise. A template that wants "Saving…" or an inline error has to mirror that promise into view state by hand, in every handler.

Freshness timers, TTL and refetch-on-focus are deliberately not part of this card ([[DOC-SPEC-DATA]] §61 keeps deferring them).

## Decision

### 1. Query keys: `findMany(type, { query })`

```js
data() {
  const page = Number(this.route.query.page ?? 1);
  const posts = this.ctx.store.findMany('post', { query: { page, status: 'published' } });
  return { posts, next: posts.meta?.nextPage };
}
```

- **`query` is its own option key.** `filter` stays the local predicate it is today and still applies on top of a query's rows. Server params never share a namespace with local options, so a server param literally named `filter` or `sort` cannot be misread.
- **The query is the adapter's `loadMany` options, unchanged** ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]): a tracked `findMany('post', { query })` dispatches `loadMany(fetch, query)`. The generated REST verb already serializes non-nullish entries with `URLSearchParams` (`GET /api/posts?page=2&status=published`); an authored verb or `adapter.defaults()` receives the object as-is. Adapters need no new parameter.
- **Cache key.** `type` + a canonical spelling of the query: keys sorted, nullish entries dropped (the same entries `URLSearchParams` drops), values limited to strings, finite numbers, booleans and arrays of those. `{ page: 2, q: null }` and `{ page: 2 }` share an entry; `{ page: 2 }` and `{ page: '2' }` do not (they are different requests to an authored verb). A function, Date, nested object or `NaN` in a query throws in development naming the key. An empty `{ query: {} }` is the same as no query.
- **Each query keeps its own ordered result.** A query entry stores the server's row order as a list of record keys, plus `meta`, its load state and its generation. `findMany` with a query returns those records in that order (records removed since are skipped), not the whole local collection. Rows still merge into the one record table by pk exactly as `loadMany` does today, so `findOne('post', 7)` sees a post loaded by any page, and an edit to it shows in every page that lists it.
- **Response shape.** A `loadMany` verb returns an array (as today) **or** `{ records: [...], meta: {...} }`. The second shape is how a server or verb reports a cursor, a total or a next page; the shape guards apply to `records`. `meta` must be a plain object or absent and is stored frozen.
- **Reading `meta`.** The array a query `findMany` returns carries a non-enumerable, frozen `meta` property (`posts.meta.nextCursor`, `posts.meta.total`). It is `undefined` for a no-query `findMany` and for a query with no `meta` in its response. Read it before `filter`/`sort`/`map`, which return plain arrays.
- **Cursors are just params.** `findMany('post', { query: { after: cursor } })` is one entry per cursor. "Load more" keeps the cursors it has walked in view state and reads each page; the store dedupes and caches every page. There is no accumulating query API.
- **First load vs. no query.** A no-query tracked `findMany` behaves exactly as D161 (LOADED/EXHAUSTIVE marks, whole local collection). A query-bearing load marks neither: a page proves nothing about the whole collection.
- **Untracked reads stay local.** Outside a tracked `data()` run, `findMany(type, { query })` returns the cached rows for that key (or `[]` if never loaded) and never fetches, like every other D161 local snapshot.
- **Explicit `store.loadMany(type, options)`** with non-nullish options now also writes the query entry for those options, so a handler-driven prefetch fills the same cache a later tracked read will hit.
- **Bounded.** Query entries live in an LRU of 200 per store. Evicting one only means the next tracked read of that key fetches again.

### 2. `store.invalidate()`

```js
store.invalidate('post');                        // every post query, the collection, every loaded post
store.invalidate('post', 7);                     // one record
store.invalidate('post', { query: { page: 2 } }); // one query (exact key match)
```

- **Marks, never fetches.** Invalidation flips state and notifies; it issues no request. A stale entry refetches the next time a tracked read needs it, so invalidating a type that nothing on screen reads costs nothing.
- **What each form marks stale:**
  - `invalidate(type)`: every query entry of that type; the type's LOADED and EXHAUSTIVE marks are cleared (an exhaustive answer is stale too); the type's negative-cache entries are dropped; and a type stale mark is set at the current read generation, so every **synced** record of that type loaded before it is stale for `findOne`.
  - `invalidate(type, id)`: that record (if present and synced) and its negative-cache entry.
  - `invalidate(type, { query })`: that one query entry.
- **How it reaches views.** Invalidation calls `_notify` for the type's collection key (and the record key for the id form), batched like any change. Every view whose `data()` read that type re-runs. During that run, a tracked read of a stale entry queues a refetch through the existing D161 fault path (same in-flight dedupe, same request map). The settle loop holds the commit until the refetch lands, so **the old rows stay on screen while the new ones load**, then the view commits once. Views reading fresh entries of the same type re-run `data()` once and commit unchanged rows.
- **Staleness test for a record.** The adapter already stamps each record with the generation of the last read that landed on it (`LOAD_GENERATIONS`). A tracked `findOne` hit refetches when the record is synced and its last read generation is older than the type's or the record's stale mark. Locally created, never-saved records are never stale.
- **Refetch replaces a query's rows.** The new response's row list replaces the entry's old one, so a row the server dropped leaves that page. Records themselves are not deleted from the store by a refetch.
- **Failures.** A refetch that fails rejects that view's run into the normal `errorView` path, as a first load does, and leaves the entry stale so the next run retries. A 404 on a stale record refetch records absence, as D161.
- Concurrency: a response dispatched before an invalidation still lands its rows (it is not dropped), but the entry stays stale, because its generation is older than the mark.

### 3. Write status on `save()` and `delete()`

```js
events = {
  async publish() {
    const save = this.props.post.update({ published: true }).save();
    // save.pending is true and save.error is null until it settles
    try { await save; } catch {}   // save.error now holds the rejection
    this.ctx.store.invalidate('post');
  },
};

data() {
  const post = this.ctx.store.findOne('post', this.route.params.id);
  // reactive: re-runs data() when a write on this record starts or settles
  const sync = post && this.ctx.store.syncStatus(post);
  return { post, saving: sync?.pending === 'save', saveError: sync?.error?.message };
}
```

- **On the promise** (handler code): the promise `save()` and `delete()` return carries `pending` (`true` until it settles) and `error` (`null`, then the rejection reason). These are plain properties for code that holds the promise; they are not reactive.
- **On the record, reactively** (template code): `store.syncStatus(record)` returns a frozen `{ pending, error }`. `pending` is `'save'`, `'delete'` or `null` (the write running at the front of the record's D132 chain, or `null` when nothing is queued). `error` is the last failed write's error, cleared when the next write on that record starts. Read inside `data()` it subscribes to the record, and every status flip notifies that record's key, which also advances its D170 render revision, so a row component looping records refreshes on its own.
- **A store method, not a record field.** Record namespaces are author schema space; `status`, `pending` and `error` are all plausible field names. `syncStatus` lives beside `modelFor` on the store and reserves nothing on records.
- A status flip is a notification with no mutation: it does not touch D125 mutation revisions, so save-response reconciliation is unchanged.

### 4. Serialization and tooling

- The HMR snapshot and the `output: 'static'` read-state island (`data-puzzle-static-read`) gain an optional `queries` field: each entry's canonical key, row keys and `meta`, without load state. Version stays `1`; older readers ignore the field, and a page without it hydrates with no query entries. Stale marks never serialize (a reload is a fresh read).
- `PuzzleApp.idle()` and `testing`'s settled helpers already ask `_reading()`; query and stale refetches register in the same in-flight maps, so both see them.
- DevTools shows query entries in the Store panel (key, row count, stale flag). Wire keys are additive.

### 5. Bundle size

Everything here is adapter-side, grafted onto the Store prototype by `installAdapter()` like D161's tracked pair. **An app without the `adapter` capability ships nothing new and its core bundle does not change.** The `/adapter` subpath grows by an estimated 1.2–1.6 KB gzip; the PR measures it with `scripts/measure-size.mjs` and reports the real number.

## Alternatives rejected

- **Flat server params beside `filter` (`findMany('post', { page: 2 })`).** Shorter, but every key except `filter` silently becomes a request param, `filter` itself can never be a server param (JSON:API uses it), and adding any future local option would be a breaking change. A named `query` maps one-to-one onto `loadMany`'s existing options argument.
- **Query handle objects (`const q = store.query('post', {...}); q.data; q.refetch()`).** A second read API beside `findMany`, with its own lifecycle to tie to views. Puzzle's rule is one obvious way; the existing tracked read plus the settle loop already gives loading-free views.
- **Invalidation that refetches eagerly.** Fetches for screens nobody is looking at, and a second refetch path beside the settle loop. Lazy marking reuses D161's dedupe, attribution and failure handling.
- **Invalidation that clears the data.** Blanks the list or flashes a skeleton on every save. Keeping stale rows readable until the settle loop commits the fresh pass is the expected behavior and costs nothing extra.
- **Reactive status as record fields (`record.$pending`, `record.saving`).** Reserves names in author schema space, and `$` names are awkward in templates.
- **Accumulating cursor queries in the store (`loadMore()`).** Merging pages is view policy (reset on filter change? cap length?). Per-cursor entries plus a cursor list in view state covers infinite scroll without a new store concept.

## Consequences

- [[DOC-SPEC-DATA]] §8, §22 and §61 change: `findMany`'s `query` option and result `meta`, `invalidate()`, `syncStatus()`, the `{ records, meta }` response shape, and the "Not supported" line loses query/pagination keys and invalidation (TTL and refetch-on-focus stay deferred). The deferred list in [[DOC-SPEC]] loses the same items.
- `types/index.d.ts` gains `FindManyOptions.query`, a `QueryResult` array type with `meta`, and the adapter-installed `invalidate()`/`syncStatus()`; `types/adapter.d.ts` gains the `{ records, meta }` result shape and `pending`/`error` on the write promises.
- No existing behavior changes: a `findMany` without `query`, a `loadMany` without options and every write path keep their current contracts.

## Out of scope (later)

Freshness timers and TTL, refetch on focus or reconnect, request cancellation, optimistic rollback helpers, pruning whole-collection records the server no longer returns, and invalidating by predicate or partial query match.
