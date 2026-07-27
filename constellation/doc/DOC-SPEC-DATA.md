---
name: SPEC — models, store, validation, and adapters
kind: reference
status: verified
connections:
  - DOC-SPEC
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
verified_at: '2026-07-25T05:53:21.105Z'
verified_sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
notes:
  - kind: verified
    text: >-
      Sections moved byte-for-byte from DOC-SPEC (scripted split, verified by SHA-identical section
      census); §N numbers unchanged
    sha: b9d736f51b1ba592e87c7946c8e1108da8c8a616
---

The frozen v1 contract for the data layer: models and schema builders, the store surface, schema validation enforcement, `hasMany`/`belongsTo` relationships, adapter write sync, the `beforeRequest` hook, and schema-driven fixtures with the mock adapter. See [[DOC-SPEC]] for the section index and the rest of the contract.

## 7. Models & schema builders

Schemas are declared with the `Puzzle` field builders — the **only** documented way to define fields (raw descriptor objects are an internal format):

```js
import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';

export default class Todo extends PuzzleModel {
  static schema = {
    id:        Puzzle.string().primary(),
    text:      Puzzle.string().required().min(1, 'Todo text cannot be empty'),
    completed: Puzzle.boolean().default(false),
    createdAt: Puzzle.date().default(() => new Date()),
    updatedAt: Puzzle.date().default(() => new Date()),
  };

  toggle() {
    return this.update({ completed: !this.completed, updatedAt: new Date() });
  }
}
```

**Types:** `Puzzle.string()`, `Puzzle.number()`, `Puzzle.boolean()`, `Puzzle.date()`, `Puzzle.array()`, `Puzzle.object()`.

**Modifiers (chainable):**

| Modifier | Meaning |
| -------- | ------- |
| `.primary()` | Primary key; implies required. |
| `.required(message?)` | Field must be present. |
| `.default(value \| () => value)` | Applied on `createRecord` when absent. |
| `.min(n, message?)` / `.max(n, message?)` | Length for strings/arrays, value for numbers/dates. |
| `.oneOf([...], message?)` | Enum constraint. |
| `.validate(fn, message?)` | Custom rule escape hatch. |

**Computed properties** are plain JavaScript getters on the model class (`get fullName() { return ... }`) — no `computedProperties` map, no registration. They work anywhere a record is read, including templates.

**v1 enforcement:** `.default()` and `.primary()` are honored by the store. Validation rules (`required`, `min`, `max`, `oneOf`, `validate`) were stored-but-inert in v1; **since v1.16 they enforce at the local write boundary** (`createRecord`/`update` throw `PuzzleValidationError`; `Model.validate(data)`/`record.validate()` return `{ valid, errors }`) — see §20 (D48). Relationships (`Puzzle.hasMany(...)` / `Puzzle.belongsTo(...)`) shipped in v1.17 as lazy store-backed getters — see §21 (D49) — replacing the old `static relationships` block.

**Server access (D21):** the model declares its server location — `static adapter = { endpoint: '/api/todos' }` — and v1 consumes it on the **read path** via `store.loadAll(type)` / `store.loadOne(type, id)` (§8). Write sync and custom adapter methods shipped in v1.18 — `record.save()`/`record.delete()`/`store.request()`, see §22 (D50); query fault-in remains deferred. Local persistence is in-memory with optional localStorage.

**Read-path response bodies** are read the same way the write verbs read theirs: parsed JSON when the body parses, raw text when it doesn't, `undefined` when empty. A 2xx whose body is empty or unparseable therefore reaches `loadAll`/`loadOne`'s own shape guard — `[puzzle] loadAll('todo') expected a JSON array from the server` — rather than escaping as a bare `SyntaxError` with no type, no URL, and no indication it came from Puzzle. *(Amended, D137: the shape guard also requires the model's primary key on every record — checked up front, before any upsert, all-or-nothing — because a pk-less server record would otherwise mint an auto-generated id marked `_synced`, whose next `save()` PUTs to a URL the server never had. Storage hydration keeps its fail-soft auto-generation.)* The practical triggers are non-JSON 2xx responses: an error page served with a 200, a captive-portal or auth-redirect interstitial, a content-encoding mismatch. A consequence worth knowing: anything replacing the fetch seam must return a genuinely Response-shaped object with a working `text()`, not `json()` alone.

## 8. Store (v1 surface)

```js
const store = this.ctx.store;

store.createRecord('todo', { text: 'Ship v1' }); // applies schema defaults
store.findOne('todo', id);
store.findMany('todo');
store.findMany('todo', { filter: (t) => !t.completed });

// server read path (D21): reads the model's static adapter.endpoint,
// prefixes the app's apiURL, upserts records (subscribers notified)
await store.loadAll('todo');
await store.loadOne('todo', id);

record.update({ completed: true }); // triggers subscribed data() re-runs
record.destroy();
```

Any query made inside `data()` auto-subscribes the component; changes to matching records re-run `data()`.

**Record identity is number/string-insensitive (D112).** The store indexes number primary keys by their string form, so `findOne('todo', id)` returns the same record whether `id` is `7` or `'7'` — route params are always strings while JSON payloads usually carry numbers. Only numbers normalize: `null`/objects keep strict identity, and there is no numeric parsing (`'01'` ≠ `1`). The record's own pk field keeps its original type; a type-variant duplicate pk is a duplicate (`createRecord` throws, `upsert` updates in place).

## 20. Schema validation enforcement (v1.16)

The rules stored by the §7 builders since v1 now enforce. Shipped in v1.16 (D48); a store/model amendment — no compiler, router, or view changes.

**Enforcement boundaries (always-on where rules are declared):**

- `store.createRecord(type, data)` validates after schema defaults and primary-key generation are applied. On failure nothing is inserted, notified, or persisted.
- `record.update(patch)` validates **only the fields present in the patch** (rules are per-field, so this is exact). On failure the record is untouched. Applies to store-attached and store-less records alike — the rules live on the class.
- Both throw **`PuzzleValidationError`** (exported from the package root): `err.errors` is `[{ field, rule, message }]` in schema-declaration order; `err.message` is the first error's message. The return-the-record contract of both methods is unchanged on success.
- **Exempt by design:** `loadAll`/`loadOne` upserts (the server is authoritative — backend drift must not crash the read path) and storage hydration (fail-soft startup, same posture as the duplicate-pk skip).

**Renderable surface (non-throwing):** static `Model.validate(data)` and instance `record.validate()` return `{ valid, errors }` with the same errors shape — validate first in form UX, then write. There is no persistent `record.errors` state (rejected in D48). *(Amended: static `validate(data)` applies schema `.default()`s before collecting errors, matching `createRecord` — a `.default(…).required()` field no longer fails a pre-create form check that the create itself would pass. Instance `validate()` reads already-defaulted fields and is unchanged.)*

**Rule semantics** (no type coercion — rules compare what they're given):

| Rule | Fails when |
| ---- | ---------- |
| `required` | value is `undefined`, `null`, or `''` |
| `min(n)` / `max(n)` | `.length` outside the bound for strings/arrays; value outside the bound for numbers/dates. **Type-aware since §35:** on a field *declared* `number()`/`date()`, a value of the wrong runtime type (e.g. a form-bound string `"150"`) fails with a type-mismatch message (`"age" must be a number`) instead of silently measuring `.length` — forms must convert before writing. `NaN`/invalid `Date` remain incomparable passes. |
| `oneOf([...])` | value is not strictly (`===`) one of the listed options |
| `validate(fn)` | `fn(value)` returns falsy — a **thrown** exception propagates (broken validator = programming error) |

`required` runs first per field and short-circuits that field's remaining rules; a non-required field whose value is `undefined`/`null` skips its remaining rules; all failing fields are collected. Type mismatches on `string()`/`array()` fields are **not** validated (a number in a `string()` field passes bounds by coincidence of the length branch). Default messages (no `message` arg) name the field and the bound.

## 21. Model relationships: `hasMany` / `belongsTo` (v1.17)

The schema entries reserved since §7 now resolve. Shipped in v1.17 (D49); a store/model amendment — no compiler, router, or view changes.

```js
// post.js
static schema = {
  id:       Puzzle.string().primary(),
  authorId: Puzzle.string(),
  author:   Puzzle.belongsTo('user'),      // infers key 'authorId' from the relationship name
  comments: Puzzle.hasMany('comment'),     // infers key 'postId' from the OWNER's registry type
};
```

- **Resolution is a lazy store query.** `post.author` ⇒ `findOne('user', post.authorId)` (`null` on miss/no store); `post.comments` ⇒ `findMany('comment', { filter: c => c.postId === post.id })` (`[]` when store-less; store insertion order — sort in `data()`). No materialization, no caching: always the live store. FK-to-pk comparison uses the same number/string-insensitive identity as `findOne` (§8, D112) — a string FK resolves a numeric pk and vice versa.
- **Reactivity rides the existing tracking:** a traversal inside `data()` auto-subscribes exactly like the manual join it replaces. Template-only access reads without subscribing — return traversals from `data()`.
- **FK convention, overridable via `{ key: '...' }`:** `belongsTo` → `<relationshipName>Id`; `hasMany` → `<ownerTypeName>Id` (the owner's model-registry key).
- **Relationship entries are not fields:** excluded from defaults, primary-key lookup, and §20 validation; not serialized by `toJSON()` (records serialize the FK, never the resolved graph). Getters are installed by the Store constructor for registered models.
- **The property name is reserved:** assigning to it (e.g. an embedded `{ author: {...} }` server payload) warns once and is ignored — set the FK field instead.

## 22. Adapter write sync (v1.18)

The write half of the D21 adapter story. Shipped in v1.18 (D50); a store/model amendment — no compiler, router, or view changes. The same `static adapter = { endpoint }` declaration drives everything; local mutation semantics (`createRecord`/`update`/`destroy`) are byte-identical to v1 — **sync is a separate, explicit verb.**

```js
const todo = store.createRecord('todo', { text: 'Ship v1.18' }); // local, instant (unchanged)
await todo.save();                    // POST apiURL+endpoint (first save) / PUT endpoint/:id (thereafter)
todo.update({ completed: true });     // local, instant (unchanged)
await todo.save();                    // PUT
await todo.delete();                  // DELETE endpoint/:id, then local remove on ack
await store.request('todo', `/${todo.id}/archive`, { method: 'POST' }); // custom endpoints
```

- **`record.save()`** — validates first (§20): invalid rejects with `PuzzleValidationError`, no request made. POST for a never-synced record, PUT for a synced one (synced = came from `loadAll`/`loadOne`/an upsert, or was saved successfully; **since §35 storage hydration restores the record's real persisted provenance** — a locally-created, never-saved record still POSTs after a reload — with markerless old-format blobs defaulting to synced). A 2xx JSON-object response merges via the exempt upsert path, **per-field since D125** — a field whose local value changed after the request was dispatched keeps the local value, while every other field (including server-computed ones the client never touched) merges as before; 204/empty keeps local state. On a **first** save whose response carries a different primary key the store re-keys atomically (the one sanctioned pk change); on an update-save a differing response pk warns and is ignored. A failed save keeps the dirty local state and rejects — retry by calling again. **Reconciliation guards (§35):** a record destroyed (or replaced at its key) while its request was in flight resolves detached — the response is never merged and the record is never re-inserted (local destruction wins); a first-save response whose assigned pk already belongs to a *different* record rejects with a plain `Error` (the HTTP call succeeded; local reconciliation refused), leaving both records untouched. **In-flight edit guard (D125):** per-field mutation revisions gate the merge above, so a save response never overwrites a keystroke made during its own round trip — the queued follow-up save then sends the newer value rather than re-sending the stale one. Pk adoption stays unconditional (identity is not a user-editable field), and `_synced` still flips to true: it records server provenance and selects POST vs PUT, so clearing it would make the queued save POST a duplicate.
- **`record.delete()`** — confirmed delete: DELETE first, local remove (normal notify path) on 2xx **or 404** (idempotent); other failures reject and the record stays. `record.destroy()` remains local-only, unchanged. **Since D132:** a **never-synced** record's `delete()` is a local removal with **no request** — the server has no row, so the old unconditional DELETE could only 404 or strand the record behind a 4xx (the D21 no-adapter rejection is checked first, so an endpoint-less model still reports that rather than quietly acting like `destroy()`); a `delete()` whose record is already `_deleted` (or store-less) when its turn comes resolves idempotently with no request, so two concurrent `delete()`s issue exactly one DELETE.
- **Write serialization (D132):** ALL of a record's server writes — `save()` **and** `delete()` — run through one per-record in-flight chain (formerly the save-only chain). Each link reads the record's state when it *reaches the front*, never when it was enqueued: a delete fired during a first save waits and builds its URL from the **adopted server pk** (previously the concurrent DELETE either left a server orphan or missed the re-keyed record and resolved having deleted nothing), and a queued save that finds its record removed rejects with the same message `record.save()` gives at call time instead of resurrecting the row. Rejections stay isolated across verbs exactly as within save-save chaining: the prior link's failure is swallowed for chaining only, and every caller observes its own promise.
- **`store.request(type, path, { method, body, headers })`** — the custom-endpoint escape hatch: prefixes `apiURL + adapter.endpoint`, JSON in/out, normalized errors. Idiom: wrap it in model instance methods.
- **Errors:** the new verbs reject with `PuzzleAdapterError` (`.status`, `.statusText`, `.body` when parseable) — exported from the package root. The D21 read path keeps its existing plain-Error messages.
- **Still deferred:** query fault-in (`findMany`'s synchronous pure-local return is load-bearing — its own decision someday), offline queueing, conflict resolution, automatic write-through.

## 49. Adapter request hook: `beforeRequest` (v1.55)

One optional app-config function shapes the `fetch` init for **every** adapter call (D91). This is where an app attaches auth headers, `credentials`, or an `AbortSignal` — previously impossible on the read path, which was a bare `fetch(url)` with no init object at all, so a token-authenticated app could not use §8's `loadAll`/`loadOne` and had to route around the adapter design entirely.

```js
new PuzzleApp({
  apiURL: '/api',
  beforeRequest(init, { type, method, url }) {
    init.headers = { ...init.headers, Authorization: `Bearer ${token()}` };
  },
});
```

- **One seam.** Every server call — the D21 read path, the D50 write verbs (`save`/`delete`), and `store.request()` — routes through a single private `Store._fetch(url, init, context)`. The read path now sends an explicit `{ method: 'GET' }` (wire-identical to a bare fetch) so a hook never has to special-case a missing init.
- **Synchronous.** The hook may mutate `init` in place **or** return a replacement object; a truthy object return wins, otherwise the possibly-mutated original is used. An async hook is deferred — see the cut list.
- **`method` and `body` are re-stamped from the original init after the hook runs**, and the URL is a separate `fetch` argument. A hook can change *how* a request is sent, never *what* it is. This is load-bearing: §22's write path captures `requestKey = record[pk]` before the await and reconciles against exactly that key afterwards, so a hook that flipped POST→PUT or rewrote the body would silently break identity re-checks, pk adoption, and the `_synced` contract.
- **The context argument is frozen** — information about the request, not a second output channel.
- **A throwing hook is not caught.** It is app code; an auth error raised there rejects the calling verb rather than shipping an unauthenticated request.
- **The network step is delegated** (v1.61, D98): after the hook runs, `_fetch` calls `Store._network(url, final, context)` — a trivial `fetch` passthrough that is the single sanctioned interception point for dev/test tooling (§52's mock adapter replaces it). Interception there runs strictly *after* `beforeRequest`, so a hook still fires in mock mode.
- **Replacement means replacement.** Returning a bare `{}` from a write drops `Content-Type: application/json`; the idiom is `return { ...init, headers: … }`. Merging was rejected — it would make removing a header impossible.
- **Config threading** follows the established conditional-passthrough convention (§2): passed to the Store only when set, so its own default (`null`) stands otherwise. A non-function value is ignored rather than stored.
- **Output modes:** the prerender path carries the hook (`ssg/index.js` `buildContext`), so a build-time `beforeMount` seed hits an authenticated API the way the browser store would. **`output: 'static'` structurally cannot** — `mountStatic`'s options are serialized into a Go-generated per-page entry module and a function does not survive that boundary, so true-static pages get no hook on their client-side store.

## 52. Schema-driven fixtures + the mock adapter (v1.57; self-contained module v1.61)

Two development/test affordances on the data layer (D95). Since D98 they live **entirely** in `@magic-spells/puzzle/fixtures` — a self-contained module that is never referenced by the core runtime. It enters an app bundle only through the §54 `--fixtures` build switch, or a direct import in tests (also re-exported from `/testing`). Core carries exactly one seam for it: `Store._network(url, init, context)`, the single place an adapter request touches `fetch`, called by §49's `_fetch` **after** `beforeRequest` runs.

**Installation.** `installFixtures(config)` attaches the system from outside: it adds `seed()`/`resetFixtureSeed()` to `Store.prototype`, replaces `_network` with mock interception, and wraps `mount` so the config's optional `setup(app)` runs at §34 beforeMount timing (after the author's own hook, before navigation #0 — the sanctioned seeding window). All PRNG/mock state lives in a module `WeakMap` keyed by store — **zero fields on the Store**. It returns `uninstall()`, matching the `installFakeAnimate`/`installFakeObserver` convention; uninstall restores the true originals and deletes the added methods.

Config shape — in an app this is the default export of `app/fixtures.js` (§54); in tests it is passed directly:

- `seed` — the deterministic PRNG seed (replaces v1.57's `fixtureSeed` app/Store option, which is **removed**).
- `mock` — per-type mock config, merged per key **over** the model's `static adapter.mock`; either side alone activates the mock for that type. Heavy `data` arrays belong here, not in model files that ship to production.
- `setup(app)` — seeding hook; `app.store.seed(…)` lands before the first `data()`.

**Fixtures.** `store.seed(type, countOrArray, overrides)` generates records from the schema alone — no extra declaration. Generation reads the §7 descriptors: `.default()` wins first (left absent so `applyDefaults` resolves it, preserving function-default and deep-clone semantics), `.oneOf()`/`.min()`/`.max()` are never violated, and records go through the normal `createRecord` path so §20 validation and pk assignment behave exactly as at runtime. A `belongsTo` FK wires to a real existing parent when one exists and is left unset otherwise. Determinism comes from the install seed driving **two** derived PRNG streams — one for values, one for mock rolls, so seeding more records never perturbs which requests fail. `resetFixtureSeed()` resets both. **The auto-generated primary key is the one non-deterministic field** (`_genId` uses `Math.random()`/`Date.now()`); an author-supplied `.primary().required()` key is fully deterministic.

**Mock adapter.** `static adapter = { endpoint, mock: { data, latency, failRate, fail, handler } }` — and/or the install config's `mock[type]` — serves the adapter verbs from an in-memory collection.

- **Interception replaces §52's `_network` seam** and returns a Response-shaped object, so `loadAll`/`loadOne`/`save`/`delete`/`request` run **completely unmodified** and the real §22 write path is exercised rather than a parallel one. The collection is deep-cloned from `mock.data` on first use.
- Default CRUD: `GET` endpoint → array; `GET endpoint/:id` → object or 404; `POST` → insert (201); `PUT endpoint/:id` → merge (200); `DELETE endpoint/:id` → 204. `handler({ method, url, path, body, collection })` overrides any of it and is how `request()`'s arbitrary paths get mocked; a falsy return falls through.
- `latency` (number or `[min, max]`) is what makes §16 skeletons and their `min-duration` hold developable at all. `failRate`/`fail` produce **non-ok responses**, so failures flow through the real error paths (`PuzzleAdapterError` on writes, the §8 throw on reads) — this is the supported way to exercise the `data()`-rejection handling §16 asks authors to write.
- §49's `beforeRequest` still runs in mock mode; no network call happens.
- A one-time `console.warn` per model class fires on first interception. It is unconditional and dev-visible: `build.dropConsole` strips all `console.*` in production by default, so gating it would be theater.
- **Without `installFixtures`, a model-declared `mock` block is inert data and requests reach the real endpoint.** That is the documented meaning of building without `--fixtures` — an explicit switch, not a heuristic, so there is no compiled-out state to defend with stubs (D96's refuse-throw is gone).

