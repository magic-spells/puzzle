---
name: Puzzle datastore
status: verified
verified_at: '2026-08-24T05:28:11.795Z'
connections:
  - DOC-SPEC
  - DOC-MODELS
  - FLOW-REACTIVITY
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-ADAPTER
  - DECISION-D161-AUTO-FETCHING-FINDS
  - FILE-STORE
  - FILE-PUZZLE-MODEL
verified_sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
notes:
  - kind: verified
    text: 'Store API''s identity-guard sentence narrowed to the automatic fault path — PR #84.'
    sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
---

# Puzzle datastore

Puzzle's data layer combines schema-backed model instances, a per-app store,
tracked queries that fetch what they're missing, optional browser persistence,
and explicit HTTP writes.
See [[DOC-MODELS]] for field-builder details and [[FLOW-REACTIVITY]] for the
render path.

## Models and records

Register `PuzzleModel` subclasses in the app's `models` config. A model may
declare:

- `static schema` with `Puzzle.string()`, `number()`, `boolean()`,
  `date()`, `object()`, `array()`, `belongsTo()`, and `hasMany()`;
- modifiers `primary`, `required`, `default`, `min`, `max`,
  `oneOf`, and custom validation;
- optional server sync via a bare `static adapter` object of fetch functions;
  `{ endpoint: '/api/posts' }` generates the standard REST five, while author
  verbs override individual transports or replace them without an endpoint.
  The app imports the capability from `@magic-spells/puzzle/adapter` and passes
  it once to `new PuzzleApp({ ..., adapter })`; an app-wide dialect instead
  passes `adapter.defaults({ ...verbs })`, with model functions still winning;
- ordinary getters and instance methods.

A stored record is an instance of that model class. Primary keys are immutable.
Server upserts retain object identity so existing references and relationships
remain valid.

## Store API

Views access the store as `this.ctx.store`.

The local methods are core. The server methods shown below are installed only
when the app passes the `/adapter` capability to `PuzzleApp`.

| API | Behavior |
| --- | --- |
| `createRecord(type, data)` | Apply defaults, generate/validate the primary key, validate all fields, insert, and notify. |
| `findOne(type, id)` | Return one record or `null`; tracked inside `data()`. Number/string-insensitive on `id` (D112). A tracked miss with a resolvable `loadOne` queues the fetch — the view's settle loop re-runs `data()` and commits the warm pass (D161) — unless the type is known EXHAUSTIVE, where the miss is the answer. |
| `findMany(type, { filter }?)` | Return local records, optionally filtered (`filter` always runs locally); tracked at collection level. First tracked read of a type with a resolvable `loadMany` queues one collection fetch and marks the type loaded on success, so later runs don't re-request it. |
| `loadOne(type, id)` | Run the model's one-record transport and identity-preserving upsert. Bypasses the D161 negative cache — the force-refresh escape hatch. Warns in dev when called through the view's own handle during that view's `data()` run. |
| `loadMany(type, options?)` | Run the collection transport, forwarding pagination options, and upsert every returned record. No-options success marks the type loaded, and exhaustive as well when the generated REST transport made the request; options-bearing loads stay partial. Warns in dev when called through the view's own handle during that view's `data()` run. `loadAll` — the pre-0.7.0 spelling — throws naming this method. |
| `adapter(type)` | Return the memoized adapter with enhanced fetch bound to all standard and custom functions. |
| `upsert(type, objectOrArray)` | Apply server-authoritative object(s) by explicit primary key, preserving identity and marking records synchronized. |
| `request(type, path?, options?)` | Custom adapter request with method/body/headers; 204/empty responses map to `null`. |

**Record identity is number/string-insensitive (D112).** The store indexes
number primary keys by their string form, so `findOne('todo', id)` returns the
same record whether `id` is `7` or `'7'` — which matters because route params are
always strings while JSON payloads usually carry numbers. `belongsTo`/`hasMany`
FK comparison uses the same rule. Only numbers normalize: `null` and objects keep
strict identity, and there is no numeric parsing, so `'01'` and `1` stay
distinct. A record's own primary-key field keeps its original type; a
type-variant duplicate is a duplicate (`createRecord` throws, `upsert` updates in
place).

**Auto-fetching finds (D161).** Inside a tracked `data()` run, a find that
misses returns its local value (`null`/locals) and queues the model's read
transport when D158 dispatch resolves one; the view does not commit that pass —
it awaits the batch and re-runs `data()`, committing the first pass whose reads
all come up warm. Committed `null` therefore always means "does not exist,"
never "still loading." Requests dedup by `recordKey` identity; a normalized 404
lands in a per-store negative cache (1000-entry LRU, never persisted) so
re-runs don't refire; ten rounds throw naming the view. Reads outside `data()`
never fetch — event handlers get local snapshots and use `refresh()` — and
apps without the capability or a resolvable read verb see pure-local behavior
exactly as before.

**Loaded vs exhaustive collections (D161/D158).** A successful no-options
`loadMany` always marks the type LOADED: the collection request has run, so a
tracked `findMany` stops re-faulting it. It marks the type EXHAUSTIVE — a
`findOne` miss answers `null` with no detail request — only when the framework
built the request itself, from the model's `endpoint`. An authored `loadMany`
(on the model, or from an `adapter.defaults()` dialect) is opaque to the
framework: returning a paginated first page is a perfectly good implementation
and says nothing about the ids it left out, so a later miss on an off-page id
still fetches rather than reporting a real record as missing.

**Transport functions (D158).** Standard verbs receive enhanced fetch first:
`loadMany(fetch, options?)`, `loadOne(fetch, id)`, `create(fetch, record)`,
`update(fetch, record)`, and `delete(fetch, record)`. It is platform-shaped —
URL plus init in, `Response` out, with no prefixing or JSON magic — and adds the
D91 hook plus fixtures interception. A framework verb may return its Response
for Puzzle to status-check and parse, or return parsed data directly. In both
cases Puzzle applies the same primary-key/shape guards and framework-owned
reconciliation. On the automatic fault path, the D158 identity guard rejects a
`loadOne` response whose pk differs from the requested id before mutation, so
an implicit fault can never miss forever; an explicit `store.loadOne` accepts
whatever record the server returns (a slug-resolving endpoint, say) and clears
the requested id's negative entry on success. Non-OK reads throw
`PuzzleAdapterError` (generated transports included); a custom `loadOne`
signals not-found with `new Response(null, { status: 404 })` — returning `null`
is a shape error. Global fetch is legal but bypasses the hook and mock seam.
Dispatch is model function → app default → endpoint-generated REST. App-default
functions receive a trailing `{ type, endpoint }` context (with `endpoint`
undefined when absent); per-model function signatures are unchanged.

The endpoint-generated `loadMany` serializes non-nullish option values with
`URLSearchParams`; authored transports receive the exact options object. Pages
accumulate in the identity map rather than replacing the collection, and an
options-bearing load marks the type neither loaded nor exhaustive.

## Validation boundaries

Local authoring operations validate before mutation and throw on failure.
`Model.validate(data, { fields }?)` and `record.validate()` support non-throwing
form UX. Static validation mirrors `createRecord`: it omits the `required` error
for an omitted/null primary field the store will generate, while preserving the
error for `''`; `{ fields }` limits validation to an edited field subset.

Server reads, public `upsert`, and storage hydration are authoritative recovery
paths and do not enforce local authoring rules. They still reject unsafe
assignment keys, framework-owned internals, and primary-key collisions that
would corrupt record identity.

## Relationships

`belongsTo(type, { key? })` reads the foreign key on the current record and
queries the related type. `hasMany(type, { key? })` queries the related
collection using the conventional or configured foreign key.

Relationships are lazy getters backed by the same store. Reading them inside
`data()` participates in normal record/collection dependency tracking, but a
traversal never fetches (D49/D161) — `post.author` across a list cannot become
N requests. When a related record is missing, add one more tracked find in
`data()` and the settle loop fetches it.

## Custom transports and endpoint responses

Custom adapter methods are never called by the framework. Invoke them through
`store.adapter(type)`, which binds enhanced fetch as their first argument, and
merge returned records explicitly:

```js
static adapter = {
  endpoint: '/api/posts',
  async publish(fetch, id) {
    return (await fetch(`/api/posts/${id}/publish`, { method: 'PATCH' })).json();
  },
};

const post = store.upsert('post', await store.adapter('post').publish(id));
```

`store.request()` returns parsed response data without changing the Store. When
a custom action returns fresh records, apply them explicitly with
`store.upsert()` instead of throwing the response away and issuing follow-up
`loadOne()` requests:

```js
async checkIn() {
  const payload = await this._store.request('habit', `/${this.id}/check-ins`, {
    method: 'POST'
  });
  return {
    habit: this._store.upsert('habit', payload.habit),
    checkin: this._store.upsert('checkin', payload.checkin)
  };
}
```

`upsert` is server-authoritative and validation-exempt. It retains an existing
record's identity or instantiates a synced record under the server-provided
primary key, notifies subscribers, and schedules persistence once per call.
Every object must carry a non-null primary key; arrays are shape/key-checked in
full before any element is applied. Envelope responses stay explicit as above.

## Reactive subscriptions

The store records queries while a view's `data()` is evaluating:

- `findOne` subscribes to a record key;
- `findMany` subscribes to a collection key;
- reevaluation replaces the prior dependency set — during a D161 settle, only
  the final warm pass's subscriptions commit;
- destroy unsubscribes the view.

Creates, updates, upserts, and destroys mark affected keys dirty. Notifications
are batched; requestAnimationFrame is primary, with a hidden-tab fallback so
backgrounded apps do not freeze. Subscriber errors are isolated. A view whose
settle loop is mid-run coalesces matching notifications into one more pass
instead of starting a competing refresh.

Records mutate in place. A child receiving only a record prop will not see its
internal changes through shallow prop comparison; pass identity and query the
record inside the child's own `data()` when it needs a live subscription.

## Persistence

When app config supplies storage, the store hydrates at startup and persists
JSON snapshots after dirty flushes. Persistence is fail-soft: unavailable or
malformed browser storage does not prevent the app from mounting. Persisted
records carry a `__synced` provenance marker; old-format blobs without it
hydrate as synced (the pre-marker behavior). D161 read state (collection
completeness, negative entries) is never persisted here — it rides only the
dev HMR snapshot and the static build's read island.

A flush serializes once for all dirty keys. App teardown forces pending
persistence before records are discarded.

## Explicit non-goals

The release does not include implicit write-through on `update()` (writes stay
explicit verbs — `save()`/`delete()`), server-side query/pagination keys on
`findMany` (fetch-all-once per type is the policy; `{ query }` pass-through is
deferred until a real wall), TTL or a public `reload(type)` invalidation API,
request cancellation, offline queues, conflict resolution, or a background
synchronization engine. Applications compose those policies around the
explicit store and adapter methods.
