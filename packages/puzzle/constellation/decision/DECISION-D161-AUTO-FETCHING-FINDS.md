---
name: D161 — Tracked finds fault in missing data; the settle loop commits complete passes
status: verified
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D49-MODEL-RELATIONSHIPS
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D39-SKELETON
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-SSG
  - DOC-DATASTORE
  - DOC-SPEC-DATA
verified_at: '2026-08-24T05:28:09.597Z'
verified_sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
code_refs:
  - client-runtime/datastore/adapter.js
  - client-runtime/datastore/store.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/capabilities.js
  - client-runtime/devstate.js
  - client-runtime/ssg/index.js
  - client-runtime/static/index.js
---

`store.findOne`/`store.findMany` fetch what is missing — but only during a tracked `data()` evaluation, and the view commits only a pass that queued no fetches. Views need no loading code; `null` in committed data means "doesn't exist", never "still loading".

## Context

An awaited `loadOne` inside `data()` loops (its own upsert notifies the subscription the read just created). Design values: low learning curve, one obvious way, no loading logic in views, no `{#await}` templates, no separate `load()` hook. This card owns tracked fault-in, the settle loop, dedup and cache policy; D158 owns the verb contract, D21 the read path, D49 relationship traversal.

## Decision

**Settle loop** (adapter-installed onto PuzzleView, wrapping every tracked `data()` run — refresh, routed preload, D146 prepareRefresh, component mount, prerender):

1. Run a pass with its own request map. An unsatisfied tracked read (a `findOne` miss, a `findMany` on a type not yet LOADED) returns its local value and queues a deduped fetch when the model has a resolvable read verb.
2. Requests queued ⇒ don't commit; await the batch, discard the pass's subscriptions, re-run.
3. Commit the first pass that queues nothing. Dependent reads (post → `post.authorId` → author) settle across rounds with no declared graph.
4. After 10 rounds (`MAX_SETTLE_ROUNDS`) **throw** through the normal data-failure path, naming the view and last round's request keys. Never warn-and-commit.

`data()` must tolerate multiple runs per navigation. All rounds count as one D39 load with the D52 hold.

**Tracked = read through the view's own store handle** (attribution by identity, not ambient state):
- The raw Store's finds are pure local reads. The tracked pair `_findOneTracked`/`_findManyTracked` takes the evaluation's request map as a parameter and lives adapter-side.
- Each view gets a HANDLE — a `Proxy` over the raw Store — and `_deriveCtx` gives the view its own `ctx` (`Object.create` off the app's base ctx, always two deep). The handle's get trap binds forwarded methods to the RAW store (read-state WeakMap keys, `_a`, `_asyncTrackingChain`, `_typeMap` and subscription Maps break under a proxy `this`); `errors.js` resolves its ctx-keyed config through the prototype chain for the same reason. An adapter-free app mints nothing.
- `withTracking` installs the request map on the handle context with save/restore stack discipline, and on exit restores the enclosing map unless the subscriber is destroyed, read live from `isDestroyed`. **`unsubscribe()` must not latch anything**: `playOut()` unsubscribes a live view that `_restoreFromLeaving()` can put back and refresh (regression: `tests/tracked-read-attribution.test.js` "a view that left and came back is fully re-armed").
- Reads through raw `app.store`, another view's handle, module captures, `record._store`, or handlers/timers/third-party code running while a view is suspended are local snapshots: they never fetch and never join another view's batch. Handlers read local and call `refresh()`.
- The dev warning for an imperative `loadOne`/`loadMany` lives on the handle, not keyed off ambient `_tracking` (which stays set across every await of a suspended `async data()`).
- Residue 1: the view's own deferred code holding its own handle during its own suspension does fault into that evaluation, so a rejection fails that refresh. Deferred code that must not fail the render reads the raw store.
- Residue 2: subscription attribution stays ambient (`_tracking`), because relationship getters resolve through `record._store`. A foreign read during a suspension can add one subscription key, reconciled away on the next evaluation.
- A plain `data()` returning a Promise runs once inline before its shape is known; a sticky per-view `_dataAsyncShape` flag feeds the loop's async hint, and a dev warn-once steers to `async data()`.

**Fetch eligibility.** A tracked miss faults only when the model itself declares server intent (its own read-verb function or an `endpoint`); `findOne` needs `loadOne`, `findMany` needs `loadMany`. An `adapter.defaults()` dialect never makes a model server-backed. Pure local: no adapter capability, no resolvable verb, nullish id, negative-cached id, LOADED type (`findMany`), EXHAUSTIVE type (`findOne`). `installFixtures()` installs the capability, so fixture apps fault through the mock at `_network`.

**Relationships never fault.** `belongsTo`/`hasMany` getters use local-only lookups that record the same subscription keys — no N+1 storms.

**Read state** (adapter-owned WeakMap keyed by Store; the no-adapter bundle carries none):
- In-flight dedup by `recordKey` identity (single records) or by type (collections).
- A never-persisted negative LRU (`MAX_ABSENT` 1000). Only a normalized 404 `PuzzleAdapterError` records absence; network/5xx/401/403/shape errors reject the run and poison nothing. Explicit `loadOne` bypasses the negative cache and clears the requested id on success.
- Only the automatic path rejects a response whose pk differs from the requested id; explicit `loadOne` accepts it (slug endpoints).
- The codecs unwrap a handle before keying.
- **LOADED vs EXHAUSTIVE** (`loaded` / `complete` sets; exhaustive ⊆ loaded). Any successful no-options `loadMany` (empty array included) marks LOADED. Only the endpoint-generated REST transport marks EXHAUSTIVE, so a `findOne` miss owes no request; an authored or dialect `loadMany` may be a paginated first page. Options-bearing loads mark nothing.

**Removal outranks reads that predate it.** `delete()` and `destroy()` record absence stamped with the next dispatch-counter value (the D138 sequence). A response for that identity whose read was dispatched before the removal is dropped before any `_upsert` side effect; a collection load keeps its other rows and still marks the type. A read dispatched after the removal clears absence normally. Re-creating the identity clears absence and inherits the stamp as its load generation. A hydrated absence carries the lowest stamp.

**The settle window is a delivery contract.** A store notification landing during a run folds into it (`_settleDirty`) and is delivered by an extra pass before commit. A run that ends without committing (superseded by a D146 prepared commit, stale, failed) hands it back through `onStoreChange()`, or the change is lost. The Store stamps notifications with a monotonic sequence; the committing pass records the sequence at its start (`_settleMark`), and a batch at or below the mark is skipped. `#commit` also stamps `Store._flushSeq` (non-zero only during `_deliverNotifications`) for a refresh that began mid-delivery, so a child woken twice by one flush skips the second (D170). The stamp is a MAX, never an assignment; it lives in core `#commit`, so adapter-free apps get it too.

**Staleness governs both outcomes.** The token/destroyed/leaving check that discards a superseded run's result also discards its failure — nothing reaches D145, `errorView` or committed state.

**Prerender** fetches at build time through the same loop; a non-404 fault failure fails the build naming the route. Node has no page origin: an absolute `apiURL` is fetched for real; a model with no `endpoint` and no read verb never faults (seed it in `beforeMount({ store })`); an app-relative URL fails with a diagnostic naming both remedies. The seam is global `fetch`, since an authored verb can hardcode a path. Static output transfers read state (`{ v, complete, loaded, absent }`) in the data-island envelope so `mountStatic` doesn't refetch; loaded-only state is enough to emit it; an older kernel reading `complete` alone stays correct. Hybrid transfers nothing (takeover re-runs `data()`). HMR snapshots carry read state, never in-flight promises.

## Gotchas

- `router.stop()` never destroys a view still in `preload()`, so an abandoned pre-commit view takes one more settle round before going quiet (bounded by dedup and the cap). `data()` is contractually re-runnable: a test view with a one-shot gate in `data()` is a wrong fixture.
- Bundle boundary: the loop installs via `installAdapter()`; `static/index.js` reaches the codecs through `capabilities.js`. Never import `datastore/adapter.js` from core or the static kernel. A no-adapter bundle must contain no `MAX_SETTLE`, "settle rounds", `_findOneTracked` or `_handleFor` — grep the built bundles to verify.

## Alternatives

- Async cache-first finds (`await store.findOne()`) — an `await` and its un-awaited-Promise failure mode in every view.
- Sync reads with reactive re-run and no settle gate — partial renders, null-guard glue, ambiguous `null`, nothing for prerender to await.
- `{#await}` template blocks — loading states in template control flow; progressive loading is a child component with its own `data()` and skeleton.
- A separate `load()`/`model()` hook — two places to fetch.
- Relationship auto-fetch — N+1 storms from list views.
- Fetching from untracked reads (handlers) — silent work with no guaranteed subscriber.
- Warn-and-commit at the round cap — breaks `null`-means-missing.
- An ambient request slot on the Store, or fencing Puzzle's reentry points — post-await segments are indistinguishable from foreign code, so timers and callbacks still leak; identity attribution covers them by construction.
- Passing the store into the hook (`data(params, props, { store })`) — a signature change everywhere, with `ctx.store` still a trap beside it.

## Consequences

Deferred deliberately: server-side query/pagination pass-through on `findMany` (fetch-all-once per type until someone hits the wall), TTL/`reload(type)` invalidation, request cancellation.
