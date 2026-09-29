---
name: Puzzle datastore
status: built
connections:
  - DOC-SPEC
  - DOC-SPEC-DATA
  - DOC-MODELS
  - FLOW-REACTIVITY
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-ADAPTER
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
  - FILE-STORE
  - FILE-PUZZLE-MODEL
  - FILE-ADAPTER
---

# Puzzle datastore

The per-app store at runtime: queries, identity, auto-fetching finds, merge and write-sync semantics, subscriptions and persistence. Declaring models, validation, relationships and adapters is [[DOC-MODELS]]; the render path is [[FLOW-REACTIVITY]].

## Store API

Views reach the store as `this.ctx.store`. `createRecord`, the finds and `flush` are core; the rest exist only with the `/adapter` capability. Records returned by any read are the live instances, mutated in place.

| API | Behavior |
| --- | --- |
| `createRecord(type, data)` | Defaults, pk, validation, insert, notify ([[DOC-MODELS]]). |
| `findOne(type, id)` | One record or `null`; subscribes the record key. May fetch (below). |
| `findMany(type, { filter }?)` | Records in insertion order; `filter` always runs locally; subscribes the collection key. May fetch (below). |
| `flush()` | Deliver pending notifications and write pending persistence now. |
| `loadOne(type, id)` | Always requests and upserts. Bypasses the negative cache (the force-refresh hatch); accepts whatever record the server returns (a slug-resolving endpoint works) and clears the requested id's absence on success. |
| `loadMany(type, options?)` | Always requests and upserts every record. No options: marks the type loaded (and exhaustive when the generated REST verb made the request). With options (`{}` included): a partial page that accumulates and marks nothing. |
| `upsert(type, objectOrArray)` | Apply server-authoritative object(s): update in place by pk or instantiate synced. Every object needs a non-null pk; arrays are shape-checked in full before any element applies. |
| `adapter(type)`, `request(...)` | Custom adapter actions ([[DOC-MODELS]]). |

## Record identity (D112)

Number primary keys index by their string form, so `findOne('todo', 7)` and `findOne('todo', '7')` find the same record — route params are strings while JSON usually carries numbers. Relationship FK matching, pk-immutability checks and save reconciliation use the same rule. Only numbers normalize: `null` and objects keep strict identity and there is no numeric parsing (`'01'` ≠ `1`). A record's own pk field keeps its original type; a type-variant duplicate is a duplicate (`createRecord` throws, `upsert` updates in place).

## Auto-fetching finds (D161)

Only a read through a view's own `this.ctx.store`, during that view's own `data()` run, can fetch. Event handlers, model methods, timers, relationship traversals and a captured `app.store` get local snapshots.

- **Eligibility.** A tracked `findOne` miss or first tracked `findMany` queues the model's read verb only when the model's own `static adapter` declares an `endpoint` or an authored function for that verb. An `adapter.defaults()` dialect alone never turns a local model into a fetching one (explicit `loadOne`/`loadMany` still dispatch through it).
- **Settle loop.** A pass that queued requests does not commit: the view awaits the batch and re-runs `data()`, committing the first pass whose reads all came up warm and adopting only that pass's subscriptions. Reads discovered in one pass fetch in parallel; dependent reads (post → `post.authorId` → author) settle across rounds. Ten rounds throw naming the view. A committed `null` therefore means "does not exist", never "still loading".
- **Dedup and absence.** Identical in-flight requests are joined. A 404 on `loadOne` records the identity absent in a per-store negative cache (1000-entry LRU, never persisted), so re-runs don't refire; any other failure fails the run and stays retryable. A local `destroy()` or confirmed `delete()` also marks the identity absent; `createRecord`, any upsert and hydration clear it.
- **Loaded vs exhaustive.** A successful no-options `loadMany` marks the type LOADED, so `findMany` stops faulting it. It marks the type EXHAUSTIVE — a `findOne` miss answers `null` with no request — only when the framework built the request from `endpoint`; an authored `loadMany` may have returned page one, so an off-page id still fetches.
- **Identity guard.** On the automatic path a `loadOne` response whose pk differs from the requested id is rejected before mutation, so a fault can never miss forever.
- Calling `loadMany`/`loadOne` through the view's handle inside its own `data()` warns in dev (use the finds). Fetch-all-once per type is the policy; there are no server-side query keys on `findMany`.

## Merges and read ordering

Every server path preserves object identity, so references and relationships stay valid. Reads are ordered by dispatch (D138): a response older than a read or save that already landed on the record does not merge, and a removal after dispatch wins over the response. Load responses skip fields the app edited locally after the request went out.

## Write sync (D50)

`record.save()` (validated first) sends `create` (POST) if the record was never synced and `update` (PUT) otherwise. `_synced` is server provenance: set by loads, upserts, hydration and successful saves; never by `createRecord`.

- **Per-record write chain.** Saves and deletes on one record serialize; each reads the record's state when it reaches the front (a double-click POSTs once, then PUTs; a queued delete uses the pk the save adopted).
- **Response merge.** A JSON-object response merges validation-exempt, preserving fields edited after dispatch (D125); 204/empty keeps local state; either way the record is synced. On a first save a different server pk is adopted and the record re-keyed (a pk already owned by another record rejects); on an update-save a pk change warns and is ignored.
- **No resurrection.** If the record was removed or replaced at its key while the request was in flight, nothing reconciles. A queued save whose record was removed rejects without sending.
- **Failure.** A non-OK response rejects with `PuzzleAdapterError` and keeps local state; retry by calling again.
- `record.delete()` sends DELETE, then removes locally on success; a never-synced record is removed locally with no request. `record.destroy()` is local-only.

## Subscriptions

Inside `data()`, `findOne` subscribes `type id` and `findMany` subscribes `type`; each run replaces the prior dependency set (D146 holds a prepared run's keys until commit), and destroy unsubscribes. Creates, updates, upserts and removals notify both levels. Notifications batch to one delivery per flush on `requestAnimationFrame`, with a 220 ms fallback timer and a direct timer when the tab is hidden (D63). Subscriber errors are isolated. A notification arriving while a view's settle loop runs coalesces into one more pass.

Every notification stamps the record's render revision (D170), so a child given a record prop refreshes when that record changes through `update()` or any store path. A related record's fields, a computed getter's inputs and direct field assignment advance no revision — a child that needs those re-queries by id in its own `data()`.

## Persistence

`new PuzzleApp({ storage: localStorage })` hydrates at construction (key `'puzzle-store'`, silently and validation-exempt) and writes one JSON snapshot per flush after delivery. Fail-soft: unavailable, full or corrupt storage never blocks mounting; a duplicate pk keeps the first record. Each record carries a `__synced` marker (a blob without it hydrates as synced). Page `pagehide` and app teardown flush pending writes. D161 read state is never persisted — it rides only the dev HMR snapshot and the static build's read island.

## Non-goals

No automatic write-through on `update()`, server-side query or pagination keys on `findMany`, TTL or a public invalidation API, request cancellation, offline queues, conflict resolution, or background sync. Apps compose those around the explicit store and adapter methods.
