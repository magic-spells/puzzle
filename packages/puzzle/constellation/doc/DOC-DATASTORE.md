---
name: Puzzle datastore
status: built
connections:
  - DOC-SPEC
  - DOC-SPEC-DATA
  - DOC-MODELS
  - FLOW-REACTIVITY
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - DECISION-D184-STORE-OBSERVE
  - DECISION-D189-AGENT-HOOKS
---

# Puzzle datastore

Using the per-app store at runtime: queries, identity, auto-fetching finds, write sync, subscriptions and persistence. Declaring models, validation, relationships and adapters is [[DOC-MODELS]]; the exact rules are [[DOC-SPEC-DATA]] §8, §22 and §61; the render path is [[FLOW-REACTIVITY]].

## Store API

Views reach the store as `this.ctx.store`. `modelFor`, `createRecord`, the finds, `observe` and `flush` are core; the rest exist only with the `/adapter` capability. Every read returns the live instances, mutated in place.

| API | Behavior |
| --- | --- |
| `modelFor(type)` | The registered model class, or `PuzzleModel` for an unknown type; `Model.primaryKey()` names its primary field. Never subscribes or fetches (D189). |
| `createRecord(type, data)` | Defaults, pk, validation, insert, notify. |
| `findOne(type, id)` | One record or `null`; subscribes that record. May fetch (below). |
| `findMany(type, { filter }?)` | Records in insertion order; `filter` runs locally; subscribes the collection. May fetch (below). |
| `observe(type, [id,] fn)` | Calls `fn()` after each flush carrying a change to the collection (or the one record); returns `stop()`. Never fetches (D184, below). |
| `flush()` | Deliver pending notifications and write pending persistence now. |
| `loadOne(type, id)` | Always requests and upserts. Bypasses the negative cache (the force-refresh hatch) and accepts whatever record the server returns, so a slug-resolving endpoint works. |
| `loadMany(type, options?)` | Always requests and upserts every record. No options: a whole-collection load. With options (`{}` included): a partial page that marks nothing. |
| `upsert(type, objectOrArray)` | Apply server data: update in place by pk or create as synced. Every object needs its pk; an array is checked in full before any element applies. |
| `adapter(type)`, `request(...)` | Custom adapter actions ([[DOC-MODELS]]). |

## Record identity (D112)

Number primary keys match their string form, so `findOne('todo', 7)` and `findOne('todo', '7')` find the same record — route params are strings while JSON usually carries numbers. There is no numeric parsing (`'01'` ≠ `1`), and a record's own pk keeps its original type.

## Auto-fetching finds (D161)

On an adapter app, write `data()` as if everything were local; missing records are fetched and the view commits once they land.

```js
data(params) {
  const store = this.ctx.store;
  const post = store.findOne('post', params.id);                // fetched if missing
  const author = post && store.findOne('user', post.authorId);  // next round
  return { post, author };
}
```

- **Only `this.ctx.store` inside the view's own `data()` fetches.** Event handlers, model methods, timers, relationship traversals and `app.store` read local snapshots — read local and call `refresh()` there.
- **Only server-backed models fetch:** the model's own `static adapter` must declare an `endpoint` or the read verb. An `adapter.defaults()` dialect alone never makes a local model fetch.
- **A committed `null` means "does not exist"**, never "still loading". Dependent reads settle across rounds; ten rounds throw naming the view. `data()` may run several times per navigation, so keep it side-effect free.
- **404s are remembered** per identity (a 1000-entry cache, never persisted), so re-runs don't refire; any other failure fails the run and stays retryable. A `destroy()` or confirmed `delete()` also marks the identity absent; creating, loading or hydrating it again clears that.
- **Collections load once.** A successful no-options `loadMany` stops `findMany` from fetching that type again. When the request came from `endpoint` (the generated REST verb), a later `findOne` miss answers `null` without a request; an authored `loadMany` may have returned page one, so an off-page id still fetches.
- Calling `loadMany`/`loadOne` inside `data()` warns in dev — use the finds. There are no server-side query keys on `findMany`; fetch-all-once per type is the policy.

## Merges and read ordering

Every server path preserves object identity, so references and relationships stay valid. Reads are ordered by dispatch (D138): a response older than a read or save that already landed does not merge, and a removal wins over a response that was in flight. Load responses skip fields edited locally after the request went out.

## Write sync (D50)

`record.save()` validates, then sends `create` (POST) if the record was never synced and `update` (PUT) otherwise. Loads, upserts, hydration and successful saves mark a record synced; `createRecord` does not.

- **One write at a time per record.** Saves and deletes on one record queue; each reads the record when it reaches the front, so a double-click POSTs once then PUTs, and a queued delete uses the pk the save adopted.
- **Response merge.** A JSON-object response merges without validation, keeping fields edited after dispatch (D125); 204/empty keeps local state. A first save adopts a different server pk and re-keys the record; an update-save ignores a pk change with a warning.
- **No resurrection.** A record removed or replaced while its request was in flight is not touched by the response.
- **Failure** rejects with `PuzzleAdapterError` (`status`, `statusText`, `body`) and keeps local state; retry by calling again.
- `record.delete()` sends DELETE, then removes locally on success; a never-synced record is removed with no request. `record.destroy()` is local-only.

Writes never happen implicitly: `update()` has no network side effect.

## Subscriptions

Inside `data()`, `findOne` subscribes that record and `findMany` the collection; each run replaces the previous set, and a destroyed view unsubscribes. Creates, updates, upserts and removals notify both levels. Notifications batch into one delivery per frame, with timers in a hidden tab (D63). A throwing subscriber does not stop the others.

Outside a view, `store.observe('task', fn)` watches the collection and `store.observe('task', id, fn)` one record (D184), including its creation if it does not exist yet. `fn()` gets no arguments and runs once per flush that carries a matching change. Each call is a separate observation; `stop()` removes exactly that one and is idempotent. Nothing stops an observer for you, so code that observes from a view calls `stop()` in its teardown.

A record prop or `{#for}` row refreshes when that record changes through `update()` or any store path (D170). A related record's fields, a getter's inputs and direct field assignment do not count — re-query by id in `data()` when a child needs those.

## Persistence

`new PuzzleApp({ storage: localStorage })` hydrates at construction (key `'puzzle-store'`, silently and without validation) and writes one JSON snapshot per flush. It is fail-soft: unavailable, full or corrupt storage never blocks mounting, and a duplicate pk keeps the first record. Sync provenance survives a reload, so a never-saved record still POSTs. `pagehide` and app teardown flush pending writes. The whole store serializes on each write, so very large stores pay for it per flush. Fetch state is never persisted.

## Non-goals

No write-through on `update()`, server-side query or pagination keys on `findMany`, TTL or a public invalidation API, request cancellation, offline queues, conflict resolution, or background sync. Apps build those around the explicit store and adapter methods.
