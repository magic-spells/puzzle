---
name: SPEC — models, store, validation, and adapters
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-ADAPTER
  - COMPONENT-FIXTURES
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D184-STORE-OBSERVE
  - DECISION-D189-AGENT-HOOKS
verified_at: '2026-11-01T19:23:56.488Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

The contract for the data layer: models and schema builders, the store, validation, relationships, adapter sync, `beforeRequest`, fixtures and the mock adapter, the opt-in `/adapter` subpath, and auto-fetching finds. See [[DOC-SPEC]] for the section index.

## 7. Models & schema builders

Fields are declared with the `Puzzle` builders — the only documented way (raw descriptor objects are internal):

```js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Todo extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
  };
  toggle() { return this.update({ completed: !this.completed }); }
}
```

**Types:** `Puzzle.string()`, `number()`, `boolean()`, `date()`, `array()`, `object()`; relationships `Puzzle.hasMany()` / `Puzzle.belongsTo()` (§21).

| Modifier | Meaning |
| -------- | ------- |
| `.primary()` | Primary key; implies required. Without one the key is `id`. |
| `.required(message?)` | Field must be present. |
| `.default(value \| () => value)` | Applied on `createRecord` when absent (object/array defaults deep-clone per record). |
| `.min(n, message?)` / `.max(n, message?)` | Length for strings/arrays, value for numbers/dates. |
| `.oneOf([...], message?)` | Enum constraint. |
| `.validate(fn, message?)` | Custom rule. |

Rules enforce at the local write boundary (§20). **Computed properties** are plain getters on the class, usable anywhere a record is read, templates included.

**Server access ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]):** a model's `static adapter` is a set of per-verb fetch functions. `{ endpoint: '/api/todos' }` generates the standard five; an authored `loadMany`, `loadOne`, `create`, `update` or `delete` wins over its generated default, and an all-custom adapter needs no endpoint. The app passes `adapter` from `@magic-spells/puzzle/adapter` (or `adapter.defaults({ ...verbs })`) to `PuzzleApp` once (§58).

**Read responses** parse like writes: JSON when it parses, raw text otherwise, `undefined` when empty, so a non-JSON 2xx reaches the verb's shape guard (`[puzzle] loadMany('todo') expected a JSON array from the server`) instead of a bare `SyntaxError`. A non-OK read throws `PuzzleAdapterError` with status and body (§61's negative cache keys off `status === 404`). Anything replacing the fetch seam must return a Response-shaped object with a working `text()`.
- Every loaded record must carry the primary key; the whole payload is checked before any upsert, all-or-nothing (D137). Storage hydration still generates a missing id, fail-soft.
- On the automatic fault path (§61) a `loadOne` response whose pk differs from the requested id (under `recordKey` normalization) rejects before mutation. Explicit `store.loadOne` is permissive — the escape hatch for slug-resolving endpoints — and clears the requested id's negative entry on success.
- Load merges are per field (D138): a field edited while the load was in flight keeps its local value; untouched fields take the server's. Edits made before dispatch take the server value; absent records merge server-wins. `upsert()`/`request()` are imperative overwrites.

## 8. Store

```js
const store = this.ctx.store;
store.modelFor('todo');                           // the registered class
store.createRecord('todo', { text: 'Ship' });     // applies schema defaults
store.findOne('todo', id);
store.findMany('todo', { filter: (t) => !t.completed });
record.update({ completed: true });               // re-runs subscribed data()
record.destroy();
const stop = store.observe('todo', fn);           // outside a view; stop() ends it
store.flush();                                    // deliver pending notifications now
// with the /adapter capability — escape hatches; tracked finds fetch on their own (§61)
await store.loadMany('todo', { page: 2 });
await store.loadOne('todo', id);                  // bypasses the negative cache
```

- Server methods exist only with the `adapter` capability. The old name `store.loadAll()` (and an adapter `loadAll` verb, model or `defaults()`) throws, steering to `loadMany`.
- **`store.modelFor(type)`** ([[DECISION-D189-AGENT-HOOKS]]) returns the registered class for an own registry key, else `PuzzleModel`; static `Model.primaryKey()` names its primary field. It never reads records, subscribes or fetches.
- **Queries inside `data()` auto-subscribe**; matching changes re-run `data()`. With the capability, a tracked `findOne`/`findMany` miss fetches and the view commits once settled (§61). **Every other read is a local snapshot**: only the per-view handle `this.ctx.store`, during that view's own `data()` run, can fetch; the raw `app.store` never does. Calling `loadOne`/`loadMany` through that handle inside a tracked run warns once per verb in development.
- **`store.observe(type, fn)` / `store.observe(type, id, fn)`** ([[DECISION-D184-STORE-OBSERVE]]) watch the collection or one record from outside a view. `fn()` runs with no arguments after the flush that carries a matching change, at most once per flush, isolated like any subscriber. A type observation fires on every create, update and removal of that type; a record observation on that record, including its creation when observed before it exists. Observing never fetches and never resets. It returns `stop()`, which removes exactly that observation, is idempotent and takes effect within the current flush; observing the same function twice gives two observations. Observers live until stopped. Bad arguments throw in development.
- **Record identity is number/string-insensitive (D112):** number pks index by their string form, so `findOne('todo', 7)` and `findOne('todo', '7')` agree. Only numbers normalize — `null`/objects keep strict identity, no numeric parsing (`'01'` ≠ `1`). The record's own pk keeps its type; a type-variant duplicate is a duplicate (`createRecord` throws, `upsert` updates in place).
- **Record render revision (D170):** every store notification stamps the record's revision, so a record passed as a prop or looped in a `{#for}` refreshes on its own mutations. A related record's fields, a getter's inputs, or a direct field assignment advance nothing — re-query by id in `data()` for those. A removed record gets no revision (its row leaves).

## 20. Schema validation enforcement

§7's rules enforce at the local write boundary (D48).

- `store.createRecord(type, data)` validates after defaults and pk generation; on failure nothing is inserted, notified or persisted. An explicit `.primary().required()` key is not generated, so a missing one fails `required`.
- `record.update(patch)` validates **only the fields in the patch**; on failure the record is untouched. Store-less records validate too (rules live on the class).
- Both throw **`PuzzleValidationError`** (package root): `err.errors` is `[{ field, rule, message }]` in declaration order; `err.message` is the first error's.
- **Exempt:** `loadMany`/`loadOne`/`upsert`, save responses, and storage hydration.
- **Non-throwing:** static `Model.validate(data, { fields }?)` (applies defaults first, like `createRecord`; a nullish implied-required pk passes) and `record.validate()` return `{ valid, errors }`. There is no persistent `record.errors`.

| Rule | Fails when |
| ---- | ---------- |
| `required` | value is `undefined`, `null`, or `''` |
| `min(n)` / `max(n)` | `.length` out of bounds for strings/arrays; value out of bounds for numbers/dates. On a `number()`/`date()` field a wrong runtime type (a form string `"150"`) fails with a type-mismatch message. `NaN`/invalid `Date` pass as incomparable. |
| `oneOf([...])` | value is not `===` one of the options |
| `validate(fn)` | `fn(value)` is falsy — a thrown exception propagates |

No coercion. `required` runs first and short-circuits that field; a non-required `undefined`/`null` skips the rest; all failing fields are collected. Other type mismatches are not validated. Default messages name the field and bound.

## 21. Model relationships: `hasMany` / `belongsTo`

```js
static schema = {
  id:       Puzzle.string().primary(),
  authorId: Puzzle.string(),
  author:   Puzzle.belongsTo('user'),   // key 'authorId' from the relationship name
  comments: Puzzle.hasMany('comment'),  // key 'postId' from the OWNER's registry type
};
```

- **A lazy local store query** (D49): `post.author` resolves the `user` under `post.authorId` (`null` on miss, nullish FK or no store); `post.comments` resolves matching `comment` records (`[]` store-less; store insertion order — sort in `data()`). No caching. Traversals subscribe like the public finds but **never fetch** (§61), so `post.author` across a list cannot become N GETs; fetch a missing related record with one more tracked find. FK→pk comparison uses §8's identity rule.
- **Reactivity:** a traversal inside `data()` subscribes; template-only access does not — return traversals from `data()`.
- **FK convention** (override with `{ key: '...' }`): `belongsTo` → `<relationshipName>Id`; `hasMany` → `<ownerTypeName>Id`.
- Relationship entries are not fields: excluded from defaults, pk lookup and §20; not serialized by `toJSON()` (records serialize the FK). The Store installs the getters at construction.
- The property name is reserved: assigning it (an embedded `{ author: {...} }` payload) warns once and is ignored.

## 22. Adapter write sync

Local mutation (`createRecord`/`update`/`destroy`) stays local and instant; **sync is a separate, explicit verb** (D50).

```js
const todo = store.createRecord('todo', { text: 'Ship' });
await todo.save();     // POST (first save) / PUT endpoint/:id (thereafter)
await todo.delete();   // DELETE endpoint/:id, then local remove
await store.request('todo', `/${todo.id}/archive`, { method: 'POST' });
```

- **`record.save()`** validates the full record first (§20; invalid rejects with no request). It sends `create` for a never-synced record and `update` for a synced one. Synced means loaded, upserted or saved; storage hydration restores it from the out-of-band `__synced` marker, and a markerless blob hydrates as synced. A 2xx JSON-object response merges **per field** (D125): a field changed locally after dispatch keeps its local value; everything else, server-computed fields included, merges. 204/empty keeps local state. A first save whose response carries a different pk re-keys atomically (the one sanctioned pk change); an update-save with a different pk warns and ignores it. A failed save keeps local state and rejects — call again to retry. Success sets `_synced`.
- **Reconciliation guards:** a record destroyed or replaced at its key while its request was in flight resolves detached — never merged or re-inserted. A first-save response whose pk belongs to a *different* record rejects with a plain `Error`, leaving both untouched.
- **`record.delete()`** dispatches first and removes locally once it resolves; a rejection leaves the record. The **generated** `DELETE` treats 404 as already gone; an authored `delete` returning a non-OK `Response` (404 included) rejects with `PuzzleAdapterError`. A **never-synced** record's `delete()` is a local removal with no request (after the missing-verb check, so an endpoint-less model still reports that). A `delete()` whose record is already removed when its turn comes resolves with no request, so concurrent deletes issue one DELETE. `record.destroy()` is local-only. Both a confirmed delete and `destroy()` record §61 absence.
- **Write serialization (D132):** a record's `save()` and `delete()` calls run through one per-record chain. Each reads the record's state when it **reaches the front**: a delete queued behind a first save uses the adopted server pk; a queued save whose record was removed rejects with `save()`'s own message. Every caller sees its own outcome; a prior link's rejection does not propagate.
- **`store.request(type, path, { method, body, headers })`** prefixes `apiURL + adapter.endpoint` (it requires `endpoint`), JSON in/out, non-OK → `PuzzleAdapterError`, empty → `null`. It never changes the store. Idiom: wrap it in model methods.
- **Errors:** every adapter failure rejects with `PuzzleAdapterError` (`.status`, `.statusText`, `.body` when parseable), exported from `/adapter`. Only post-2xx local guards (response shape, pk collision) are plain `Error`s.
- Reads fetch transparently (§61); **writes stay explicit** — there is no network in `update()`, no offline queue, conflict resolution or write-through.

**Transport contract (D158).** Verbs: `loadMany(fetch, options?)`, `loadOne(fetch, id)`, `create(fetch, record)`, `update(fetch, record)`, `delete(fetch, record)`. The supplied `fetch` has platform fetch's signature and `Response` result — no URL prefixing, no automatic JSON — and runs §49's hook and §52's network seam. A verb may return parsed data or a `Response`; for a Response, Puzzle converts non-OK to `PuzzleAdapterError` and parses the body, then applies the same shape guards and reconciliation as generated verbs. Reads must return pk-bearing object(s); create/update return a pk-bearing object or nullish (no echo); delete's return is ignored after the Response check. A custom `loadOne` signals not-found with a 404 Response. A missing verb with no `endpoint` rejects with a per-verb error naming the signature.
- **Dispatch:** model function → app `adapter.defaults()` function → endpoint-generated REST. App defaults receive `{ type, endpoint }` after the normal arguments. Capabilities are per Store, so two apps on one page can differ.
- `store.loadMany(type, options?)` passes options unchanged to an authored verb; the generated verb serializes non-nullish entries with `URLSearchParams` (no options → the bare collection URL). Results merge by pk. A no-options success marks the type LOADED for §61; EXHAUSTIVE only when the generated transport made the request.
- `store.adapter(type)` returns a stable per-store, per-type object with the enhanced fetch pre-bound to every function, generated verbs included. It is the only way to call a custom function; results are usually passed to `store.upsert()`. Code using global fetch bypasses the hook and the mock seam. Model adapter keys other than `endpoint`, `mock` and functions warn once per model in development.

## 49. Adapter request hook: `beforeRequest`

One optional app-config function shapes the `fetch` init for **every** adapter call ([[DECISION-D91-ADAPTER-REQUEST-HOOK]]) — auth headers, `credentials`, an `AbortSignal`.

```js
new PuzzleApp({
  apiURL: '/api',
  beforeRequest(init, { type, method, url }) {
    init.headers = { ...init.headers, Authorization: `Bearer ${token()}` };
  },
});
```

- **One seam:** every generated verb, every enhanced-fetch call and `store.request()` passes through it, §61 fetches included. Generated reads send an explicit `{ method: 'GET' }`. Global fetch bypasses it.
- **Synchronous.** Mutate `init` in place or return a replacement; a truthy object return wins. Async hooks are not supported.
- **`method` and `body` are re-stamped from the original after the hook**, and the URL is a separate argument — a hook changes *how*, never *what* (§22's reconciliation depends on it).
- The context argument is frozen. **A throwing hook is not caught** — it rejects the calling verb rather than sending an unauthenticated request.
- **Replacement means replacement:** returning `{}` drops `Content-Type: application/json`; use `return { ...init, headers: … }`.
- The hook runs before the network seam §52 replaces, so it still runs in mock mode. A non-function value is ignored.
- **Output modes:** prerender carries the hook, so build-time seeding and §61 fetches hit an authenticated API. `output: 'static'` pages cannot carry it in the browser — `mountStatic`'s options pass through a generated module, and a function does not survive that.

## 52. Schema-driven fixtures + the mock adapter

Development/test affordances in `@magic-spells/puzzle/fixtures` (D95, D98), outside core. They enter a bundle only through `--fixtures` (§54) or a direct test import (also re-exported from `/testing`). `--fixtures` is refused together with a prerender output mode.

**Installation.** `installFixtures(config)` installs the adapter capability, adds `store.seed()`/`store.resetFixtureSeed()`, replaces the adapter's network seam with mock interception (after `beforeRequest`, instead of the real fetch), and wraps `mount` so `setup(app)` runs at `beforeMount` timing (after the app's own hook, before navigation #0). It returns `uninstall()`, which restores the originals and deletes the added methods. Config (the default export of `app/fixtures.js`/`.ts`, or passed directly in tests):
- `seed` — the deterministic PRNG seed.
- `mock` — per-type mock config, merged per key over the model's `static adapter.mock`; either alone mocks the type. Heavy `data` belongs here, not in shipped model files.
- `setup(app)` — seeding hook; `app.store.seed(…)` lands before the first `data()`.

**Fixtures.** `store.seed(type, countOrArray, overrides)` generates records from the schema alone: a declared `.default()` is left to resolve normally, `.oneOf()`/`.min()`/`.max()` are never violated, and records go through `createRecord`, so §20 and pk assignment behave as at runtime. A `belongsTo` FK wires to an existing parent when there is one. One seed drives **two** PRNG streams — values and mock rolls — so seeding more records never changes which requests fail; `resetFixtureSeed()` resets both. The auto-generated pk is the one non-deterministic field; an author `.primary().required()` key is deterministic.

**Mock adapter.** `static adapter = { endpoint, mock: { data, latency, failRate, fail, handler } }` (and/or the install config's `mock[type]`) serves requests from an in-memory collection, deep-cloned from `mock.data` on first use.
- Interception returns a Response-shaped object, so `loadMany`/`loadOne`/`save`/`delete`/`request` and §61 fetches run **unmodified** through the real paths.
- Default CRUD: `GET` endpoint → array; `GET endpoint/:id` → object or 404; `POST` → insert (201); `PUT endpoint/:id` → merge (200, the stored pk wins); `DELETE endpoint/:id` → 204. `handler({ method, url, path, body, collection })` overrides any of it (and serves deeper `request()` paths); a falsy return falls through.
- `latency` (number or `[min, max]`) makes skeletons and `min-duration` developable. `failRate`/`fail` produce **non-OK responses** (500), so failures run through the real `PuzzleAdapterError` paths; a mock 404 exercises §61's negative cache.
- `beforeRequest` still runs; no network call happens. A one-time `console.warn` per model fires on first interception.
- **Without `installFixtures`, a model's `mock` block is inert** and requests reach the real endpoint.

## 58. Opt-in server adapter subpath

The server runtime is exported from `@magic-spells/puzzle/adapter`, not the package root (D157). An app opts in once:

```js
// app/app.js
import { PuzzleApp } from '@magic-spells/puzzle';
import { adapter } from '@magic-spells/puzzle/adapter';
const app = new PuzzleApp({ target: '#app', routes, models, adapter });

// app/models/post.js
class Post extends PuzzleModel { static adapter = { endpoint: '/api/posts' }; }
```

- `adapter` is a frozen opaque capability. `adapter.defaults(verbs)` returns another frozen capability carrying app-wide verbs (§22 dispatch). Passing either installs the server methods (idempotent) before the Store is built.
- A truthy non-capability `config.adapter` is a construction-time error naming the import. Apps that never pass it have no `loadMany`, `loadOne`, `upsert`, `request`, `adapter()`, `save` or `delete`, no settle loop, and ship none of the network runtime. In development, a model with `static adapter` config but no capability warns with the model name and fix.
- `PuzzleAdapterError` is exported only from `/adapter`. SSG, the static kernel, `/testing` and `/fixtures` install the same capability before constructing stores.

## 61. Auto-fetching finds: tracked fetch and the settle loop

Tracked `findOne`/`findMany` fetch what the store is missing; views need no loading code ([[DECISION-D161-AUTO-FETCHING-FINDS]]). **Server data comes from `data()` — a committed `null` means the record does not exist, never "still loading".**

```js
data(params) {
  const store = this.ctx.store;
  const post = store.findOne('post', params.id);                // miss → GET queued
  const author = post && store.findOne('user', post.authorId);  // next round
  return { post, author };
}
```

- **The settle loop** wraps every tracked `data()` evaluation (refresh, routed preload, D146 prepare, component mount, prerender) once the capability is installed. A pass that queued fetches is not committed: the batch is awaited, that pass's subscriptions are dropped, and `data()` re-runs. The first pass that queues nothing and has no folded notification commits its model and subscriptions. Reads found in one pass fetch in parallel; dependent reads settle across rounds. After **ten provisional rounds** (a dirty re-pass counts) a pass that still needs work throws through the normal data-failure path, naming the view and the round's request keys.
- **Attribution is by identity — `this.ctx.store` is the fetching channel.** On an adapter app each view reads through its own per-view handle (`ctx` is prototype-chained off the app's, so `router` and the rest stay live; an adapter-free app keeps the raw store). A read fetches only through that handle, by that view, during its own evaluation (before or after an `await`). Reads by anyone else — the raw `app.store`, another view's handle, a relationship getter — are local snapshots. One residue: deferred code inside `data()` holding the view's own handle (a `setTimeout`) is attributed to that view while its evaluation is open; read through the raw store to keep it out.
- **Fetch eligibility:** a tracked miss fetches only when the model's **own** `static adapter` declares an `endpoint` or an authored function for the read verb (`findOne` → `loadOne`, `findMany` → `loadMany`). An `adapter.defaults()` dialect alone never makes a local model fetch (explicit `loadOne`/`loadMany` still dispatch through it). No capability, a nullish/unkeyable id, a negative-cached id, a type already LOADED (for `findMany`) or EXHAUSTIVE (for `findOne`) ⇒ local. Untracked reads (handlers, model methods) never fetch — read local and call `refresh()`.
- **Per-store caches:** in-flight dedup by identity (same-pass duplicates and concurrent views share one request); a **1000-entry negative LRU** of 404'd identities (never persisted; explicit `loadOne` bypasses it and clears the entry on success); and two collection sets. A successful no-options collection load marks the type **LOADED** (an empty array counts; options-bearing loads mark nothing). It marks it **EXHAUSTIVE** — a `findOne` miss is an authoritative "does not exist" — only when the generated REST transport made the request; an authored `loadMany` (model or `defaults()`) may be a first page, so a later miss still fetches. Exhaustive implies loaded.
- **Absence outranks older reads.** Removing a record (`delete()` ack or `destroy()`) records absence newer than every read already dispatched. A response for that identity dispatched **before** the removal is dropped for that identity only, so a collection load keeps its other rows and still marks the type loaded. A read dispatched **after** the removal clears absence and merges. Creating a record at that identity inherits the removal's ordering, so the older response cannot merge into it either. A hydrated absence blocks nothing.
- **Failures:** only a 404 becomes `null` + a negative entry. Network errors, 5xx, 401/403 and shape errors reject the run into the normal navigation-failure / `errorView` path and poison no caches.
- **Skeletons:** all rounds count as one §16 load; without a skeleton the previous route holds until settlement.
- **Notifications mid-settle** coalesce into one more pass rather than a competing refresh. A run that ends without committing (superseded, stale or failed) hands a folded notification back to the view on screen. The flush carrying a settle's own upserts does not re-run the view that committed behind it (a fetching settle renders once). A destroyed, leaving or superseded view stops its loop without aborting shared requests; a stale pass is dropped whether it fulfilled or rejected.
- **Output modes:** a prerender read must be answerable from the build machine. An absolute `apiURL` is fetched for real; a model with no `endpoint` and no read verb never fetches (seed it in `beforeMount({ store })`); an app-relative URL fails the build naming the route and both remedies. Static pages carry read state in a second island (`data-puzzle-static-read`, `{ v: 1, complete, loaded, absent }`, `complete` = exhaustive) hydrated after records, so `mountStatic` repeats none of the build's loads or 404s. Hybrid transfers nothing (takeover re-runs `data()`). The dev HMR snapshot carries read state; in-flight requests never transfer.
- **`data()` must tolerate multiple runs per navigation.**

Not supported: server-side query/pagination keys on `findMany`, TTL/`reload(type)` invalidation, request cancellation, relationship fetching (§21 traversals stay local by design).
