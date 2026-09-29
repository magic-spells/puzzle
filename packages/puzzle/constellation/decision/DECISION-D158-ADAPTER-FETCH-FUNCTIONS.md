---
name: D158 — Adapters are per-model fetch functions; REST conventions are the shorthand
status: verified
connections:
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - DECISION-D161-AUTO-FETCHING-FINDS
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/datastore/adapter.js
---

## Context

Most real servers deviate from any one REST dialect (EmberData's chronic "write a custom adapter" pain). TanStack Query won by making the transport *your fetch function*. Puzzle wants that transport contract while keeping what a query cache does not give: a normalized identity-keyed store, validation, reactivity and the D50 write-safety machinery.

## Decision

A model's `static adapter` is a set of **fetch functions**. `endpoint` is shorthand that generates the REST five; an author function always wins over its generated default, and an adapter of only author functions (no `endpoint`) is legal.

```js
static adapter = { endpoint: '/api/posts' };                 // generated REST
static adapter = { loadMany: (fetch) => fetch('/v2/posts') }; // return the Response
static adapter = {
  endpoint: '/api/posts',
  async loadMany(fetch) { return (await (await fetch('/api/posts')).json()).data; },
  publish: (fetch, id) => fetch(`/api/posts/${id}/publish`, { method: 'PATCH' }),
};
```

**`fetch` argument.** Same signature and `Response` as `window.fetch`, but the D91 `beforeRequest` hook runs first and the call goes through the `_network` seam (so `/fixtures` mocks it). A function that uses global `fetch` bypasses auth and mocks — the parameter list shows which is in play.

**Five verbs**, signature `(fetch, ...args)`; generated defaults exist only with `endpoint`:

| verb | called by | default | must return |
|---|---|---|---|
| `loadMany(fetch, options?)` | `store.loadMany`, tracked `findMany` fault (D161) | `GET endpoint?options` | array, or a `Response` |
| `loadOne(fetch, id)` | `store.loadOne`, tracked `findOne` fault | `GET endpoint/id` | record object, or a `Response` |
| `create(fetch, record)` | `save()` on never-synced | `POST endpoint` | record with pk, nullish ("no echo"), or a `Response` |
| `update(fetch, record)` | `save()` on synced | `PUT endpoint/pk` | same as create |
| `delete(fetch, record)` | `record.delete()` | `DELETE endpoint/pk`, 404 = gone | nothing, or a `Response` |

- **`Response` convenience:** returning the `Response` makes Puzzle ok-check it (non-OK → `PuzzleAdapterError` with status + body) and JSON-parse before the shape guards.
- **Read failures normalize** to `PuzzleAdapterError`; D161's negative cache keys on exactly `status === 404`, anything else stays retryable. On the implicit fault path a `loadOne` response whose pk differs from the requested id (under `recordKey`) rejects before upsert; explicit `store.loadOne()` stays permissive (slug lookups).
- **Write returns are enforced, not coerced:** a 2xx body that is a primitive, array, `{}` or pk-less object throws a plain `Error` (the HTTP conversation succeeded, so no `PuzzleAdapterError`). `_synced` stays false, so a retried `save()` re-POSTs — a duplicate row if the first POST landed. That is the accepted cost; a server that acknowledges without echoing needs a `create`/`update` that returns nothing.
- **Framework owns everything after the return:** upsert by pk, D125/D138 revision guards, `_synced` flip, pk adoption/re-keying, per-record write chain, persistence, notification. Generated and author verbs behave identically downstream.
- **Custom keys** (`publish`, `search`) are never called by the framework. `store.adapter(type)` returns the adapter with the enhanced `fetch` pre-bound (generated verbs included), so `store.adapter('post').publish(7)` works and composes with `store.upsert`.
- **`loadAll` is a hard error everywhere** (model adapter key at Store init, `adapter.defaults({ loadAll })`, `store.loadAll()`, the verb-binding loop), production included — silently ignoring it would fall through to generated REST.

**App-wide dialect: `adapter.defaults(verbs)`**, conventionally in `app/adapter.js`:

```js
export default adapter.defaults({
  loadOne: async (fetch, id, { endpoint }) => (await (await fetch(`${endpoint}/${id}`)).json()).data,
});
```

- Dispatch precedence: model function → app default → endpoint-generated REST.
- App functions get a trailing `{ type, endpoint }`; `endpoint` is the raw model value (not `apiURL`-prefixed — only generated transports prepend `apiURL`).
- Only verb keys with function values are valid; others warn in dev (`loadAll` throws).
- Returns a new recognized capability, so two apps on a page can carry different dialects.
- **This is the last tier** — no `buildURL`/`handleResponse` hooks, per-group defaults or serializers. What three tiers cannot express is written as whole verb functions.
- Under `output: 'static'`, a dialect in `app/adapter.js` can be imported by each page entry alone; an inline one forces pages to import the app entry (D157 tiers).

**Automatic fault eligibility is narrower than dispatch.** A tracked find faults only when the *model* declares server intent (its own verb function or `endpoint`); an app default supplies the dialect but does not make a local-only model server-backed. Explicit loads and writes use the full precedence.

**LOADED vs EXHAUSTIVE.** Any successful no-options `loadMany` marks the type LOADED (a tracked `findMany` stops re-faulting). Only the endpoint-generated transport (endpoint declared, no model function, no dialect function for the verb) marks it EXHAUSTIVE, so a `findOne` miss owes no detail request. An authored `loadMany` may return a paginated first page; marking it exhaustive would report real records as missing.

`endpoint` is required only by a verb that needs it (per-verb "no adapter declared" error). Unknown non-function keys other than `endpoint` and D95 `mock` warn once per model in dev.

Gotcha: in adapter.js, `responsePk == null && pk in body` looks unreachable after the pk guard but is not (the two read `body[pk]` separately, so an unstable getter reaches it); it protects pk-index integrity. Don't delete it.

## Alternatives

- Fixed dialect with bypass-only escape — most servers deviate, so partial override must be the main path.
- Class-based adapters (`RESTAdapter.extend`) — Ember ceremony; a plain object in the model is the whole surface.
- Serializer/normalizer hooks — solve envelopes but not verbs, URLs or methods; unwrapping is one line in a fetch function.
- App-level adapter registry — separates transport from the model it serves.
- Full TanStack query cache — adopted for transport only; the normalized store stays.
- A `request.get/post` helper — a second HTTP vocabulary with an abstraction ceiling; the `Response` return gives the one-liner without new API.
- Naming the argument `ctx` — collides with the app's `ctx` (store/router context).
- Mutating `Model.adapter` from app.js for app-wide overrides — order-sensitive mutation at a distance; `adapter.defaults()` is declarative.
- An opt-in "exhaustive" verb flag — new API for a rule the framework can derive.

## Consequences

Any fetch snippet drops into an adapter unchanged and gains auth and mocking. Stricter write guards reject servers that answered "OK" or `true`. Dispatch and the enhanced-fetch builder live in the adapter module only (D157).
