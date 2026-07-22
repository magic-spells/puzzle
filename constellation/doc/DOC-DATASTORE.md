---
name: Puzzle datastore
status: verified
verified_at: '2026-07-22T00:04:05.380Z'
connections:
  - DOC-SPEC
  - DOC-MODELS
  - FLOW-REACTIVITY
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - FILE-STORE
  - FILE-PUZZLE-MODEL
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
- `static adapter = { endpoint: '/api/posts' }`;
- ordinary getters and instance methods.

A stored record is an instance of that model class. Primary keys are immutable.
Server upserts retain object identity so existing references and relationships
remain valid.

## Store API

Views access the store as `this.ctx.store`.

| API | Behavior |
| --- | --- |
| `createRecord(type, data)` | Apply defaults, generate/validate the primary key, validate all fields, insert, and notify. |
| `findOne(type, id)` | Return one record or `null`; tracked inside `data()`. |
| `findMany(type, { filter }?)` | Return local records, optionally filtered; tracked at collection level. |
| `loadOne(type, id)` | GET the adapter endpoint/id and identity-preserving upsert. |
| `loadAll(type)` | GET the collection endpoint and upsert every returned record. |
| `upsert(type, objectOrArray)` | Apply server-authoritative object(s) by explicit primary key, preserving identity and marking records synchronized. |
| `request(type, path?, options?)` | Custom adapter request with method/body/headers; 204/empty responses map to `null`. |

Local record methods:

- `record.update(patch)`: validate patched fields, mutate locally, notify;
- `record.destroy()`: remove locally, mark this instance deleted, and notify;
- `record.validate()`: return `{ valid, errors }` without throwing;
- `record.save()`: validate the full record, POST when new or PUT when already
  synchronized, then safely apply the response; reject before the adapter when
  the instance is already deleted;
- `record.delete()`: DELETE first, then remove locally on success or 404; once
  removed, later calls on the same instance resolve without another request;
- `record.toJSON()`: return enumerable data only.

`PuzzleValidationError` represents local schema failures.
`PuzzleAdapterError` carries HTTP/request context — `.status`, `.statusText`,
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

## Custom endpoint responses

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
