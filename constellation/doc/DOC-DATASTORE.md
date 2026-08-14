---
name: Puzzle datastore
status: built
verified_at: '2026-07-25T05:23:39.381Z'
connections:
  - DOC-SPEC
  - DOC-MODELS
  - FLOW-REACTIVITY
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - FILE-STORE
  - FILE-PUZZLE-MODEL
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

# Puzzle datastore

Puzzle's data layer combines schema-backed model instances, a per-app store,
tracked queries, optional browser persistence, and explicit HTTP reads/writes.
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
  it once to `new PuzzleApp({ ..., adapter })`;
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
| `findOne(type, id)` | Return one record or `null`; tracked inside `data()`. Number/string-insensitive on `id` (D112). |
| `findMany(type, { filter }?)` | Return local records, optionally filtered; tracked at collection level. |
| `loadOne(type, id)` | Run the model's one-record transport and identity-preserving upsert. |
| `loadAll(type, options?)` | Run the collection transport, forwarding pagination options, and upsert every returned record. |
| `adapter(type)` | Return the memoized adapter with enhanced fetch bound to all standard and custom functions. |
| `upsert(type, objectOrArray)` | Apply server-authoritative object(s) by explicit primary key, preserving identity and marking records synchronized. |
| `request(type, path?, options?)` | Custom adapter request with method/body/headers; 204/empty responses map to `null`. |

**Record identity ignores number/string spelling (D112).** The store indexes
number primary keys by their string form, so `findOne('todo', id)` returns the
same record whether `id` is `7` or `'7'` — which matters because route params are
always strings while JSON payloads usually carry numbers. `belongsTo`/`hasMany`
FK comparison uses the same rule. Only numbers normalize: `null` and objects keep
strict identity, and there is no numeric parsing, so `'01'` and `1` stay
distinct. A record's own primary-key field keeps its original type; a
type-variant duplicate is a duplicate (`createRecord` throws, `upsert` updates in
place).

**Transport functions (D158).** Standard verbs receive enhanced fetch first:
`loadAll(fetch, options?)`, `loadOne(fetch, id)`, `create(fetch, record)`,
`update(fetch, record)`, and `delete(fetch, record)`. It is platform-shaped —
URL plus init in, `Response` out, with no prefixing or JSON magic — and adds the
D91 hook plus fixtures interception. A framework verb may return its Response
for Puzzle to status-check and parse, or return parsed data directly. In both
cases Puzzle applies the same primary-key/shape guards and framework-owned
reconciliation. Global fetch is legal but bypasses the hook and mock seam.

The endpoint-generated `loadAll` serializes non-nullish option values with
`URLSearchParams`; authored transports receive the exact options object. Pages
accumulate in the identity map rather than replacing the collection.

**Shaping outgoing requests: `beforeRequest` (D91).** Generated transports,
enhanced fetch calls, and `request()` funnel through one place, and the optional
synchronous `beforeRequest(init, { type, method, url })` config hook shapes the
`init` before it goes out. This is the auth-header seam; it is deliberately
synchronous, so inline token refresh is not supported.

Local record methods:

- `record.update(patch)`: validate patched fields, mutate locally, notify;
- `record.destroy()`: remove locally, mark this instance deleted, and notify;
- `record.validate()`: return `{ valid, errors }` without throwing;
- `record.save()`: validate the full record, dispatch `create` when new or
  `update` when synchronized, then safely apply the response; the endpoint
  defaults are POST and PUT respectively;
- `record.delete()`: dispatch delete first, then remove locally on success; the
  endpoint default treats 404 as success. Once
  removed, later calls on the same instance resolve without another request;
- `record.toJSON()`: return enumerable data only.

`PuzzleValidationError` represents local schema failures.
`PuzzleAdapterError`, exported from `@magic-spells/puzzle/adapter`, carries HTTP/request context — `.status`, `.statusText`,
and `.body` (parsed JSON when parseable, else text). A failed save keeps the
dirty local record for retry; a failed delete keeps it in the store. Only the
first save adopts server keys: on an update-save a differing response pk warns
and is ignored while other fields still merge.

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
`data()` participates in normal record/collection dependency tracking.

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
- reevaluation replaces the prior dependency set;
- destroy unsubscribes the view.

Creates, updates, upserts, and destroys mark affected keys dirty. Notifications
are batched; requestAnimationFrame is primary, with a hidden-tab fallback so
backgrounded apps do not freeze. Subscriber errors are isolated.

Records mutate in place. A child receiving only a record prop will not see its
internal changes through shallow prop comparison; pass identity and query the
record inside the child's own `data()` when it needs a live subscription.

## Persistence

When app config supplies storage, the store hydrates at startup and persists
JSON snapshots after dirty flushes. Persistence is fail-soft: unavailable or
malformed browser storage does not prevent the app from mounting. Persisted
records carry a `__synced` provenance marker; old-format blobs without it
hydrate as synced (the pre-marker behavior).

A flush serializes once for all dirty keys. App teardown forces pending
persistence before records are discarded.

## Explicit non-goals

The release does not include automatic query fault-in, implicit write-through
on `update()`, offline queues, conflict resolution, pagination/caching policy,
or a background synchronization engine. Applications compose those policies
around explicit store and adapter methods.
