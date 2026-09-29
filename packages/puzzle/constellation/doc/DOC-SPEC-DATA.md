---
name: SPEC — models, store, validation, and adapters
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
verified_at: '2026-08-24T05:28:11.239Z'
verified_sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
---

The contract for the data layer: models and schema builders, the store, validation, relationships, adapter write sync, `beforeRequest`, fixtures and the mock adapter, the opt-in `/adapter` subpath, and auto-fetching finds. See [[DOC-SPEC]] for the section index.

## 7. Models & schema builders

Fields are declared with the `Puzzle` builders — the **only** documented way (raw descriptor objects are internal):

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
| `.primary()` | Primary key; implies required. |
| `.required(message?)` | Field must be present. |
| `.default(value \| () => value)` | Applied on `createRecord` when absent (object/array defaults deep-clone per record). |
| `.min(n, message?)` / `.max(n, message?)` | Length for strings/arrays, value for numbers/dates. |
| `.oneOf([...], message?)` | Enum constraint. |
| `.validate(fn, message?)` | Custom rule. |

Validation rules enforce at the local write boundary (§20). **Computed properties** are plain getters on the class (`get fullName()`), usable anywhere a record is read, templates included.

**Server access (D21/D157/D158/D161):** a model's `static adapter` is a set of per-verb fetch functions. `{ endpoint: '/api/todos' }` generates the standard five; an author `loadMany`, `loadOne`, `create`, `update` or `delete` function wins over its generated default, and an all-custom adapter needs no endpoint. Model files import nothing extra. The app passes `adapter` from `@magic-spells/puzzle/adapter` (or `adapter.defaults({ ...verbs })`) to `PuzzleApp` once (§58). Local persistence is in-memory with optional localStorage.

**Read-path responses** parse like writes: JSON when it parses, raw text otherwise, `undefined` when empty — so a non-JSON 2xx (an error page served 200, a captive portal) reaches the verb's shape guard (`[puzzle] loadMany('todo') expected a JSON array from the server`) rather than a bare `SyntaxError`. A **non-OK** read throws `PuzzleAdapterError` with status and body (the §61 negative cache keys off `status === 404`). Anything replacing the fetch seam must return a genuinely Response-shaped object with a working `text()`.
- The shape guard requires the primary key on every record, checked up front before any upsert, all-or-nothing (D137) — a pk-less record would mint a local id marked synced whose next `save()` PUTs a URL the server never had. Storage hydration keeps fail-soft id generation.
- On the automatic fault path a `loadOne` response whose pk differs from the requested id (under `recordKey` normalization) rejects before mutation, or the fault would re-miss every round. Explicit `store.loadOne` is permissive — the escape hatch for slug-resolving endpoints — and clears the requested id's negative entry on success.
- The load merge is per field (D138): each existing record's mutation revision is snapshotted at dispatch, so a field edited **while** the load was in flight keeps its local value and untouched fields take the server's. Pre-dispatch edits take the server value; absent records merge server-wins; `upsert()`/`request()` are imperative overwrites.

## 8. Store

```js
const store = this.ctx.store;
store.createRecord('todo', { text: 'Ship' });     // applies schema defaults
store.findOne('todo', id);
store.findMany('todo', { filter: (t) => !t.completed });
record.update({ completed: true });               // re-runs subscribed data()
record.destroy();
// with the /adapter capability — escape hatches; tracked finds fetch on their own (§61)
await store.loadMany('todo', { page: 2 });
await store.loadOne('todo', id);                  // bypasses the negative cache
```

- Server methods exist only with the `adapter` capability; `store.loadAll()` and an adapter `loadAll` verb throw naming `loadMany`.
- **Queries inside `data()` auto-subscribe**; matching changes re-run `data()`. With the capability, a tracked `findOne`/`findMany` miss faults the data in and the view commits once settled (§61). **Every other read is a pure local snapshot** — the raw `app.store` never fetches; fetching belongs to the per-view handle `this.ctx.store` during that view's own `data()` run. Calling `loadOne`/`loadMany` through that handle inside a tracked run warns once per verb in development.
- **Record identity is number/string-insensitive (D112):** number pks are indexed by their string form, so `findOne('todo', 7)` and `findOne('todo', '7')` agree (route params are strings, JSON usually numbers). Only numbers normalize — `null`/objects keep strict identity, no numeric parsing (`'01'` ≠ `1`). The record's own pk keeps its type; a type-variant duplicate is a duplicate (`createRecord` throws, `upsert` updates in place).
- **Record render revision (D170):** every observable mutation path (create, `update()`, upsert, save reconciliation) funnels through the store's notify, which stamps the record's `RENDER_REV` symbol (`client-runtime/renderRev.js`) with the notification sequence. A record passed as a prop or looped in a `{#for}` therefore refreshes on its own mutations; a related record's fields, a getter's inputs, or a direct field assignment advance nothing — re-query by id in `data()` for those. A removed record gets no revision (its row leaves).

## 20. Schema validation enforcement

§7's rules enforce at the local write boundary (D48).

- `store.createRecord(type, data)` validates after defaults and pk generation; on failure nothing is inserted, notified or persisted.
- `record.update(patch)` validates **only the fields in the patch**; on failure the record is untouched. Applies to store-less records too (rules live on the class).
- Both throw **`PuzzleValidationError`** (package root): `err.errors` is `[{ field, rule, message }]` in declaration order; `err.message` is the first error's. Success still returns the record.
- **Exempt:** `loadMany`/`loadOne` upserts (the server is authoritative) and storage hydration (fail-soft startup).
- **Non-throwing:** static `Model.validate(data)` (applies `.default()`s first, like `createRecord`) and `record.validate()` return `{ valid, errors }`. There is no persistent `record.errors` (rejected).

| Rule | Fails when |
| ---- | ---------- |
| `required` | value is `undefined`, `null`, or `''` |
| `min(n)` / `max(n)` | `.length` out of bounds for strings/arrays; value out of bounds for numbers/dates. On a field declared `number()`/`date()`, a wrong runtime type (a form string `"150"`) fails with a type-mismatch message — convert before writing. `NaN`/invalid `Date` pass as incomparable. |
| `oneOf([...])` | value is not `===` one of the options |
| `validate(fn)` | `fn(value)` is falsy — a **thrown** exception propagates |

No coercion. `required` runs first and short-circuits that field; a non-required `undefined`/`null` skips the rest; all failing fields are collected. Type mismatches on `string()`/`array()` fields are not validated. Default messages name the field and bound.

## 21. Model relationships: `hasMany` / `belongsTo`

```js
static schema = {
  id:       Puzzle.string().primary(),
  authorId: Puzzle.string(),
  author:   Puzzle.belongsTo('user'),   // key 'authorId' from the relationship name
  comments: Puzzle.hasMany('comment'),  // key 'postId' from the OWNER's registry type
};
```

- **A lazy local store query** (D49): `post.author` resolves the `user` under `post.authorId` (`null` on miss or no store); `post.comments` resolves matching `comment` records (`[]` store-less; store insertion order — sort in `data()`). No caching. Traversals record the same subscription keys as the public finds but **never fault in** (§61) — `post.author` across a list cannot become N GETs; fetch a missing related record with one more tracked find. FK→pk comparison uses §8's number/string-insensitive identity.
- **Reactivity:** a traversal inside `data()` subscribes like the manual join; template-only access does not subscribe — return traversals from `data()`.
- **FK convention** (override with `{ key: '...' }`): `belongsTo` → `<relationshipName>Id`; `hasMany` → `<ownerTypeName>Id`.
- Relationship entries are not fields: excluded from defaults, pk lookup and §20; not serialized by `toJSON()` (records serialize the FK). Getters are installed by the Store constructor.
- The property name is reserved: assigning it (an embedded `{ author: {...} }` payload) warns once and is ignored.

## 22. Adapter write sync

Local mutation (`createRecord`/`update`/`destroy`) stays local and instant; **sync is a separate, explicit verb** (D50, D157, D158).

```js
const todo = store.createRecord('todo', { text: 'Ship' });
await todo.save();     // POST (first save) / PUT endpoint/:id (thereafter)
await todo.delete();   // DELETE endpoint/:id, then local remove
await store.request('todo', `/${todo.id}/archive`, { method: 'POST' });
```

- **`record.save()`** validates first (§20; invalid rejects with no request). POST for a never-synced record, PUT for a synced one (synced = loaded, upserted, or saved; storage hydration restores real provenance via the out-of-band `__synced` marker, and markerless blobs default to synced). A 2xx JSON-object response merges **per field** (D125): a field changed locally after dispatch keeps its local value; everything else, server-computed fields included, merges. 204/empty keeps local state. A first save whose response carries a different pk re-keys atomically (the one sanctioned pk change); an update-save with a different pk warns and ignores it. A failed save keeps dirty state and rejects — call again to retry. `_synced` flips to true on success (it selects POST vs PUT; clearing it would make a queued save POST a duplicate).
- **Reconciliation guards:** a record destroyed or replaced at its key while its request was in flight resolves detached — never merged or re-inserted; a first-save response whose pk belongs to a *different* record rejects with a plain `Error`, leaving both untouched.
- **`record.delete()`** dispatches first and removes locally once it resolves; a rejection leaves the record. The **generated** `DELETE` treats 404 as already gone; an author `delete` returning a non-OK `Response` (404 included) rejects with `PuzzleAdapterError` — idempotent-on-404 is the author's to implement. A **never-synced** record's `delete()` is a local removal with no request (after the missing-verb check, so an endpoint-less model still reports that). A `delete()` whose record is already `_deleted` or store-less when its turn comes resolves with no request, so concurrent deletes issue one DELETE. `record.destroy()` is local-only. Both a confirmed delete and a `destroy()` record §61 absence.
- **Write serialization (D132):** all of a record's server writes — `save()` and `delete()` — run through one per-record chain. Each link reads the record's state when it **reaches the front**: a delete queued behind a first save builds its URL from the adopted server pk; a queued save that finds its record removed rejects with `save()`'s own message. Failures stay isolated: a prior link's rejection is swallowed for chaining only; every caller sees its own promise.
- **`store.request(type, path, { method, body, headers })`** prefixes `apiURL + adapter.endpoint`, JSON in/out, normalized errors. Idiom: wrap it in model methods.
- **Errors:** every adapter failure rejects with `PuzzleAdapterError` (`.status`, `.statusText`, `.body` when parseable), exported from `/adapter`. Only post-2xx local guards (write-response shape, pk collision) stay plain `Error`s.
- Reads fault in transparently (§61); **writes stay explicit** — implicit network in `update()` is rejected. Offline queueing, conflict resolution and write-through are not supported.

**Transport contract (D158).** Verbs: `loadMany(fetch, options?)`, `loadOne(fetch, id)`, `create(fetch, record)`, `update(fetch, record)`, `delete(fetch, record)`. A `loadAll` key throws naming `loadMany` (at `defaults()` validation and at Store init). The supplied `fetch` has platform fetch's signature and `Response` result — no URL prefixing, no automatic JSON — and runs §49's hook and §52's network seam. A verb may return parsed data or a real `Response`; for a Response, Puzzle converts non-OK to `PuzzleAdapterError`, parses the body, then applies the same shape guards and reconciliation as generated verbs. Reads require pk-bearing object(s) (`loadOne`'s pk must match on the fault path only); create/update require a pk-bearing object or a nullish no-echo; delete ignores its return after checking a Response. A missing verb needs `endpoint` or rejects with a per-verb no-adapter error (on the §61 fault path, the find stays local instead).
- **Dispatch:** model function → app `adapter.defaults()` function → endpoint-generated REST. App defaults receive `{ type, endpoint }` after the normal arguments. Configured capabilities are Store-scoped, so apps on one page can differ.
- `store.loadMany(type, options?)` forwards options unchanged to an authored verb; the generated verb serializes non-nullish entries with `URLSearchParams` (no options → the bare collection URL). Pages accumulate and merge by pk. A no-options success marks the type LOADED for §61; EXHAUSTIVE only when the generated transport made the request.
- `store.adapter(type)` returns a stable per-store, per-type view with the enhanced fetch pre-bound to every function, generated verbs included; custom methods are author-invoked and commonly compose with `store.upsert()`. Code using global fetch bypasses the hook and mock seam. Non-function keys other than `endpoint` and `mock` warn once per model in development.

## 49. Adapter request hook: `beforeRequest`

One optional app-config function shapes the `fetch` init for **every** adapter call (D91) — auth headers, `credentials`, an `AbortSignal`.

```js
new PuzzleApp({
  apiURL: '/api',
  beforeRequest(init, { type, method, url }) {
    init.headers = { ...init.headers, Authorization: `Bearer ${token()}` };
  },
});
```

- **One seam:** every generated verb, every enhanced-fetch call and `store.request()` goes through `Store._fetch(url, init, context)` (installed by `/adapter`), the §61 fault path included. Generated reads send an explicit `{ method: 'GET' }`. Global fetch bypasses it.
- **Synchronous.** Mutate `init` in place or return a replacement; a truthy object return wins. (An async hook is not supported: awaiting it would sit in front of every call and need a coalescing story against §22's chain; widening later stays compatible. A whole-`fetch` override is rejected on the same grounds.)
- **`method` and `body` are re-stamped from the original after the hook**, and the URL is a separate argument — a hook changes *how*, never *what*. §22's reconciliation depends on it.
- The context argument is frozen. **A throwing hook is not caught** — it rejects the calling verb rather than sending an unauthenticated request.
- **Replacement means replacement:** returning `{}` drops `Content-Type: application/json`; use `return { ...init, headers: … }` (merging was rejected — it would make removing a header impossible).
- After the hook, `_fetch` calls `Store._network(url, final, context)` — a `fetch` passthrough and the single sanctioned interception point (§52), so the hook still runs in mock mode.
- Passed to the Store only when set; a non-function value is ignored.
- **Output modes:** the prerender context carries the hook (`ssg/index.js` `buildContext`), so build-time seeding and §61 faults hit an authenticated API. `output: 'static'` pages cannot carry it — `mountStatic`'s options pass through a generated module and a function does not survive that.

## 52. Schema-driven fixtures + the mock adapter

Development/test affordances in `@magic-spells/puzzle/fixtures` (D95, D98), outside core. They enter a bundle only through `--fixtures` (§54) or a direct test import (also re-exported from `/testing`). `/fixtures` installs the adapter capability, then replaces `Store._network` — the single place generated verbs, enhanced fetch and `store.request()` touch global fetch, called after `beforeRequest`. Author code naming global fetch bypasses it.

**Installation.** `installFixtures(config)` adds `seed()`/`resetFixtureSeed()` to `Store.prototype`, replaces `_network` with mock interception, and wraps `mount` so `setup(app)` runs at `beforeMount` timing (after the author's hook, before navigation #0). All PRNG/mock state lives in a module WeakMap keyed by store — no Store fields. It returns `uninstall()`, restoring the originals and deleting the added methods. Config (the default export of `app/fixtures.js`, or passed directly in tests):
- `seed` — the deterministic PRNG seed.
- `mock` — per-type mock config, merged per key over the model's `static adapter.mock`; either alone activates the mock. Heavy `data` belongs here, not in shipped model files.
- `setup(app)` — seeding hook; `app.store.seed(…)` lands before the first `data()`.

**Fixtures.** `store.seed(type, countOrArray, overrides)` generates records from the schema alone: `.default()` wins first (left absent so defaults resolve normally), `.oneOf()`/`.min()`/`.max()` are never violated, and records go through `createRecord`, so §20 and pk assignment behave as at runtime. A `belongsTo` FK wires to an existing parent when there is one. The seed drives **two** PRNG streams — values and mock rolls — so seeding more records never changes which requests fail; `resetFixtureSeed()` resets both. The auto-generated pk is the one non-deterministic field; an author `.primary().required()` key is deterministic.

**Mock adapter.** `static adapter = { endpoint, mock: { data, latency, failRate, fail, handler } }` (and/or the install config's `mock[type]`) serves the verbs from an in-memory collection, deep-cloned from `mock.data` on first use.
- Interception returns a Response-shaped object, so `loadMany`/`loadOne`/`save`/`delete`/`request` and §61 faults run **unmodified** through the real paths.
- Default CRUD: `GET` endpoint → array; `GET endpoint/:id` → object or 404; `POST` → insert (201); `PUT endpoint/:id` → merge (200); `DELETE endpoint/:id` → 204. `handler({ method, url, path, body, collection })` overrides any of it (and mocks `request()` paths); a falsy return falls through.
- `latency` (number or `[min, max]`) makes skeletons and `min-duration` developable. `failRate`/`fail` produce **non-ok responses**, so failures run through the real `PuzzleAdapterError` paths; a mock 404 exercises §61's negative cache.
- `beforeRequest` still runs; no network call happens. A one-time `console.warn` per model fires on first interception (production strips `console.*` by default).
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

- `adapter` is a frozen opaque capability whose idempotent installer grafts the server methods onto `Store`, `PuzzleModel` and `PuzzleView` (the §61 settle executor) before Store construction. `adapter.defaults(verbs)` returns another frozen capability carrying app-wide verbs; each Store retains its identity without core importing the adapter module. The installed surface includes `store.adapter(type)`.
- A truthy non-capability `config.adapter` is a construction-time error naming the import. Apps that never pass it have no `loadMany`, `loadOne`, `upsert`, `request`, `save` or `delete`, no settle loop, and ship none of the network runtime. In development, a model with truthy `static adapter` config but no capability warns with the model name and fix.
- `PuzzleAdapterError` is exported only from `/adapter`. Per-record write chains and §61 read state (in-flight dedup, negative LRU, loaded/exhaustive sets) live in adapter-module WeakMaps keyed by Store; core keeps `_synced`/`_deleted` provenance and inert `apiURL`/`beforeRequest` config. The read-state codecs `serializeReadState`/`hydrateReadState` are registered on the `capabilities.js` relay, so the static kernel and devstate reach them without importing this module. SSG, the static kernel, `/testing` and `/fixtures` install the same capability before constructing stores.

## 61. Auto-fetching finds: tracked fault-in and the settle loop

Tracked `findOne`/`findMany` fetch what the store is missing; views need no loading code (D161). **Server data comes from `data()` — a committed `null` means the record does not exist, never "still loading".**

```js
data(params) {
  const store = this.ctx.store;
  const post = store.findOne('post', params.id);                // miss → GET queued
  const author = post && store.findOne('user', post.authorId);  // next round
  return { post, author };
}
```

- **The settle loop** wraps every tracked `data()` evaluation (refresh, routed preload, D146 prepare, component mount, prerender) once the capability is installed. A pass whose misses queued fetches is not committed: the batch is awaited, the pass's subscriptions unwound, and `data()` re-runs; the first pass that queues nothing commits its model and subscriptions. **Ten rounds** throw through the normal data-failure path, naming the view and the round's request keys.
- **Attribution is by identity — `this.ctx.store` is the fetching channel.** On an adapter app each view reads through its own per-view **handle**, minted in the constructor (`ctx` is prototype-chained off the app's, so `router`/`formatters` stay live; an adapter-free app keeps the raw store). A read faults only through that handle, by that view, during its own evaluation (before or after an `await`). The request map rides the handle's context; the Store has no ambient request slot, so reads by anyone else — the raw `app.store`, another view's handle, a module capture, a relationship getter's `_store` — are pure local snapshots. The dev nudge for `loadOne`/`loadMany` uses the same identity. Residues: the view's own deferred code holding its own handle during its evaluation (a `setTimeout` inside `data()`) is attributed to it and can fail that refresh with a 5xx (read through the raw store to keep it out); subscription attribution stays ambient, so a foreign read during a suspension can add one key that the next evaluation reconciles away.
- **Fetch eligibility:** a tracked miss faults only when §22's dispatch resolves the read verb (`findOne` → `loadOne`, `findMany` → `loadMany`). No capability, no resolvable verb, nullish/unkeyable id, negative-cached id, a type already LOADED (for `findMany`) or EXHAUSTIVE (for `findOne`) ⇒ local. Untracked reads (handlers, model methods) never fetch — read local and call `refresh()`.
- **Per-Store caches, adapter-owned:** in-flight dedup by `recordKey` (same-pass duplicates and concurrent views share one request); a **1000-entry negative LRU** of normalized 404s (never persisted; explicit `loadOne` bypasses it and clears the id's entry on success); and two collection sets. A successful no-options collection load marks the type **LOADED** (an empty array counts; options-bearing loads mark nothing). It marks it **EXHAUSTIVE** — a `findOne` miss is an authoritative "does not exist" — only when the framework generated the request (§58's endpoint default); an authored `loadMany` (model-level or `adapter.defaults()`) may be a first page, so a later miss still fetches. Exhaustive implies loaded.
- **Absence outranks older reads.** Removing a record by any path (`delete()` ack or `destroy()`) records absence stamped one step ahead of every read already dispatched (the D138 counter). A response for that identity dispatched **before** the removal is dropped — no merge, no absence clearing, no allocation, no notify — per identity, so a collection load keeps its other rows and still marks the type loaded. A read dispatched **after** the removal clears absence and merges; creating a record at that identity inherits the removal's stamp, so the older response cannot merge into it either. A hydrated absence carries the lowest stamp and blocks nothing.
- **Failures:** only a normalized 404 becomes `null` + a negative entry. Network errors, 5xx, 401/403 and shape errors reject the run into the normal navigation-failure / `errorView` path and poison no caches.
- **Skeletons:** all rounds count as one §16 load; without a skeleton the previous route holds until settlement.
- **Notifications mid-settle** coalesce into one more pass rather than a competing refresh. A run that ends without committing (superseded by a D146 commit, stale, or failed) hands a folded notification back so it reaches the view on screen. The flush carrying a settle's own upserts is skipped by the view that committed behind it (a fetching settle renders once); other writers' changes are still delivered. A destroyed/leaving/superseded view stops its loop without aborting shared requests, and a destroyed view's suspended evaluation cannot fault. A stale pass is dropped whether it fulfilled or rejected, so its failure reaches neither the view nor §60.
- **Output modes:** a prerender read must be answerable from the build machine. An absolute `apiURL` drives the loop for real; a model with no `endpoint` and no read verb never faults (seed it in `beforeMount({ store })`); an app-relative URL fails the build naming the route and both remedies. §49's hook runs in the build context. Static pages carry read state in a second island (`data-puzzle-static-read`, `{ v: 1, complete, loaded, absent }`) hydrated after records, so `mountStatic` repeats none of the build's loads or 404s. A merely LOADED type transfers on that alone, and loaded-only state is enough to emit the island. `complete` means exhaustive; an envelope without `loaded` reads `complete` as both. Hybrid transfers nothing (takeover re-runs `data()`). The dev HMR snapshot carries read state; in-flight promises never transfer.
- **`data()` must tolerate multiple runs per navigation.**

Not supported: server-side query/pagination keys on `findMany`, TTL/`reload(type)` invalidation, request cancellation, relationship fault-in (§21 traversals stay local by design).
