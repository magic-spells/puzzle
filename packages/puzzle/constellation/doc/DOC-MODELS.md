---
name: Puzzle models — declaring models, validation, relationships, adapters
status: built
connections:
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - DOC-SPEC
  - DOC-SPEC-DATA
  - DOC-DATASTORE
  - DOC-TESTING
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
---

Defining models from an app author's view: builders, keys, validation, getters and methods, the registry, the record lifecycle, relationships, and declaring a server adapter. Using the store at runtime (queries, auto-fetching, write sync, subscriptions, persistence) is [[DOC-DATASTORE]]; the enforceable contract is [[DOC-SPEC-DATA]] §7, §20–§22.

# Puzzle models

A model is a plain class extending `PuzzleModel` with a `static schema` built from `Puzzle.*` builders (never hand-write raw descriptor objects). Records the store returns **are instances of that class**, so getters and methods work everywhere a record is read, templates included.

```js
// app/models/todo.js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Todo extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
  };

  get isActive() { return !this.completed; }            // computed property

  markComplete() {                                      // instance method
    return this.completed ? this : this.update({ completed: true });
  }
}
```

## Registry

`app/models/index.js` exports `{ todo: Todo }`, passed as `new PuzzleApp({ ..., models })`. The key is the type string every store call takes (`store.findMany('todo')`); convention is lowercase singular. `store.modelFor(type)` returns the class back (D189). A TypeScript app uses `app/models/<name>.ts` with a typed fields interface (`puzzle generate` writes it).

## Builders

The types and modifiers are in [[DOC-SPEC-DATA]] §7. Things worth knowing when choosing them:

- A `.default()` function runs per record; an object/array literal is cloned per record.
- **Primary keys.** Without `.primary()` the key is `id`. `createRecord` generates a random string key when the pk is nullish — except for an explicit `.primary().required()` (a user-supplied slug), which fails `required` instead. Once a record is in a store its pk is immutable: `update()` throws on a change.
- **Reserved names.** In development the Store throws at construction for a schema entry named after a model method (including `PuzzleModel`'s own and `toString`/`valueOf`) or a reserved field (`_store`, `_type`, `_synced`, `_deleted`, `__synced`, `__proto__`, `constructor`, `prototype`). In every build an incoming key that would land on a getter, method or reserved field is dropped (dev warns once).

## Validation

Rules throw `PuzzleValidationError` at the local write boundary — `createRecord` checks every field, `update(patch)` only the patched ones, `save()` the full record before any request. Server data and storage hydration are exempt. The full rule table is §20.

For form UX, validate first and write after: `Model.validate(data, { fields }?)` (applies defaults; `fields` limits the check to an edited subset) and `record.validate()` return `{ valid, errors }` without throwing; `errors` is `[{ field, rule, message }]` in schema order. There is no coercion: form inputs hand you strings, and a string on a `number()`/`date()` field fails `min`/`max` (`"age" must be a number`), so convert before writing.

**Dates from JSON.** Every JSON read path (loads, upserts, save responses, hydration) revives declared `date()` fields from ISO strings or epoch millis. A bare `YYYY-MM-DD` becomes a local-midnight calendar date that serializes back to the same string in any time zone (D114). `createRecord`/`update` do not coerce.

## Computed properties and methods

Computed properties are plain getters — no registration, recomputed on every read. Keep them cheap; heavy filtering and sorting belongs in `data()`. Business logic is ordinary instance methods; `this` is the record.

Mutate records only through `record.update(patch)` or a store path. `update()` merges, notifies subscribers and returns the record, so methods can `return this.update(...)`. A direct assignment (`todo.title = 'x'`) notifies nothing and is invisible to cached list rows. A single-field form write needs no handler: `checked={ todo.completed }` binds through the same validated `update()` (D147).

## Record lifecycle

1. `store.createRecord(type, data)` — defaults, pk, validation, insert, notify.
2. `record.update(patch)` — validate the patch, merge, notify.
3. `record.destroy()` — local removal; notifies so lists drop it.

Removal is terminal for the instance. After `destroy()` or a confirmed `delete()`, a later `delete()` resolves with the same record and sends nothing, and `save()` rejects with `cannot save a deleted record`. An instance built with `new` was never in a store: its `delete()` and `save()` reject. `toJSON()` is the record's own enumerable fields.

## Relationships (D49)

```js
static schema = {
  id:       Puzzle.string().primary(),
  authorId: Puzzle.string(),
  author:   Puzzle.belongsTo('user'),     // the user under this.authorId
  comments: Puzzle.hasMany('comment'),    // comments where c.postId === this.id
};
```

- **Foreign keys by convention.** `belongsTo` reads `<relationshipName>Id`; `hasMany` matches `<ownerRegistryType>Id` on the related records. Override with `{ key: 'writtenBy' }`.
- **Lazy, local, uncached.** Each read is a live local query: `null` for a miss, a nullish FK or a store-less record; `hasMany` returns insertion order (`[]` store-less) — sort in `data()`. Cycles (`post.author.posts`) are safe. **A traversal never fetches**; when a related record may be missing, add a tracked `findOne` on the FK in `data()` and the settle loop fetches it.
- **Subscribe from `data()`.** A traversal inside `data()` subscribes like the equivalent find; read only in the template it subscribes nothing.
- **Not fields.** No modifiers; defaults, pk lookup and validation never see them; `toJSON()` serializes the FK. Assigning the name (an embedded `{ author: {...} }` payload) is ignored with a dev warning — set the FK. There is no `static relationships` block.

## Declaring a server adapter (D157, D158)

Opt-in: `import { adapter } from '@magic-spells/puzzle/adapter'` and pass it once, `new PuzzleApp({ ..., models, adapter, apiURL })`. Without it records have no `save()`/`delete()`, the store has no server methods, finds are local, and a model declaring `static adapter` gets a dev warning. What reads and writes do at runtime is [[DOC-DATASTORE]].

A model's `static adapter` takes `endpoint`, `mock` (the `/fixtures` mock, [[DOC-TESTING]]) and functions; other keys warn in dev. `endpoint` generates the REST five against `apiURL + endpoint`: `loadMany` GET (options → query string, nullish dropped), `loadOne` GET `/:id`, `create` POST, `update` PUT `/:id` (JSON `toJSON()` body), `delete` DELETE `/:id` (404 = already gone).

Authored verbs override generated ones or work with no endpoint: `loadMany(fetch, options?)`, `loadOne(fetch, id)`, `create(fetch, record)`, `update(fetch, record)`, `delete(fetch, record)`. Use the `fetch` you are handed — it is platform-shaped (no URL prefixing) and routes through `beforeRequest` and the fixtures mock; global fetch bypasses both. Return the `Response` (non-OK rejects with `PuzzleAdapterError`; the body is parsed) or parsed data. Every returned record needs its pk. A custom `loadOne` signals not-found with a 404 Response — returning `null` is a shape error. A server that does not echo the record needs a `create`/`update` that returns nothing.

Dispatch per verb: model function → app default → generated REST. For an app-wide dialect pass `adapter.defaults({ ...verbs })` instead of the bare capability; each default gets a trailing `{ type, endpoint }`. A dialect alone does not make a model without its own `static adapter` auto-fetch.

Any other function key is a custom action the framework never calls. Call it through `store.adapter(type)` (memoized, fetch bound) and merge the result explicitly; `store.request(type, path?, { method, body, headers })` is the endpoint-prefixed JSON escape hatch (requires `endpoint`, never changes the store):

```js
static adapter = {
  endpoint: '/api/posts',
  async publish(fetch, id) {
    return (await fetch(`/api/posts/${id}/publish`, { method: 'PATCH' })).json();
  },
};

const post = store.upsert('post', await store.adapter('post').publish(id));
```
