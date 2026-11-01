---
name: Store
status: verified
connections:
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ADAPTER
  - COMPONENT-DEVSTATE
  - FLOW-REACTIVITY
  - FILE-STORE
  - DOC-SPEC-DATA
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D184-STORE-OBSERVE
  - DECISION-D189-AGENT-HOOKS
verified_at: '2026-11-01T19:23:56.488Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Store

Reactive record registry (`client-runtime/datastore/store.js`) for the configured model classes. The author contract is [[DOC-SPEC-DATA]] §8; server sync and fetching are [[COMPONENT-ADAPTER]], which wraps several of these methods.

## Records and identity

- `createRecord` applies defaults, generates or honors the pk, validates, rejects duplicates, indexes and notifies. A `.primary().required()` key is NOT generated on `createRecord` (so validation rejects a blank one, matching `Model.validate()`); hydration and server upserts call `_instantiate` with `validate = false` and still generate a missing key.
- **Identity is number/string-insensitive** ([[DECISION-D112-STORE-ID-KEY-NORMALIZATION]]): every id-keyed index access and both sides of `hasMany`'s FK filter go through model.js's `recordKey` (numbers → string; fields keep their type).
- `modelFor(type)` is public ([[DECISION-D189-AGENT-HOOKS]]) and resolves OWN properties only — a persisted key like `"constructor"` must not resolve to `Object`.
- `removeRecord` deletes from the index, then sets `_deleted` and clears `_store` before notifying — one terminal state shared by `destroy()` and confirmed delete, so stale references can't `save()` a copy back.
- Dev-only registration guards (reserved `__synced`, schema entries named after methods or reserved fields) live in the module-level `assertModelSchemas`, not in class methods — esbuild never drops class members, so only a module function behind the `__PUZZLE_DEV__` probe tree-shakes.

## Finds and tracking

- `findOne`/`findMany` on the core Store are plain local reads (`_findOneLocal`/`_findManyLocal`). The fetching pair `_findOneTracked`/`_findManyTracked` is grafted on by the adapter and only a view's store handle calls it ([[DECISION-D161-AUTO-FETCHING-FINDS]]). Core's share of D161 is the `HANDLE_CTX` symbol and its install/restore in `withTracking`/`unsubscribe`.
- **`this._a = options.adapter`** is the per-store gate. The adapter installs its methods on the prototypes once per realm and never removes them, so method presence can't say whether THIS app opted in. `withTracking` installs a request map only when `_a` is set. **Tests of the fetch path must pass `adapter` in Store options AND read through `store._handleFor(subscriber)`** — a raw `store.findOne` is always local.
- `withTracking(subscriber, fn, expectsAsync, pending, requests)` records collection and record-key reads; each run replaces the subscriber's previous set, transactionally (a failing run drops only its own additions). `pending` is the D146 held eval: reconcile is parked for the caller, and `_heldKeys` (refcounted) fences those keys from other evals ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). `requests` goes on `subscriber[HANDLE_CTX]` with save/restore stack discipline — the Store has no ambient request slot. `unsubscribe()` clears it; the restore is skipped only when the subscriber `isDestroyed` (read live — `playOut()` unsubscribes a view that may come back).
- **Async tracking serializes**: sync evals run inline even while an async eval is suspended, but one store-wide `_asyncTrackingChain` lets only one async `data()` run at a time. A sync-shaped function that returns a Promise while another async eval is active is dropped and retried behind the chain, so `data()` must be safe to rerun.
- Relationship getters (installed on the shared class prototype at construction, once per class) use the local reads through the record's own `_store`: reactive, never fetching. A record holds the raw Store, so a getter has no handle.

## Notification delivery

- `_notify(type, id)` bumps `_notifySeq` and stamps it into `_pendingKeys` (`Map<key, seq>`) for both the collection key and the record key. Anything sampling pending keys (`testing/settled.js`, devperf) iterates `.keys()`.
- `_deliverNotifications` gathers first (`subscriber → highest seq`), then calls `sub.onStoreChange(seq)`; function subscribers are called with no argument. Subscribers added mid-delivery are not notified for that batch; subscribers removed mid-delivery are re-checked against the key set they were gathered from and skipped — the only guard a `store.observe()` callback has.
- **`observe(type, [id,] fn)`** ([[DECISION-D184-STORE-OBSERVE]]) links a fresh wrapper closure straight into `subscribersByKey`/`keysBySubscriber` — a function subscriber outside `withTracking`, so no reset, no request map, no fetch. The wrapper clears `_tracking` while `fn` runs, so reads inside it are never credited to a suspended async `data()`. The key is spelled as `_findOneLocal`/`_notify` spell it. `stop()` is `_dropSubscription(key, wrapper)`. There is no observe-specific emission. DevTools reports observers as `'fn'`.
- `flush()` delivers each subscriber once in isolation (sync throws and function-subscriber rejections are logged, delivery continues), writes pending persistence, then (dev) reports the batch to devperf and the DevTools bridge behind inline probes. Scheduling is the shared `scheduler.js` frame (rAF plus a 220 ms fallback timer; a timer alone when hidden).
- **Render revision** (D170, `renderRev.js`): `_notify` stamps its sequence onto the record's `RENDER_REV` Symbol (defined non-enumerable at `_instantiate`, value 0, so every record has one hidden class). The revision never advances apart from a notification. A removal misses the lookup (deleted before notify), and the lookup uses `recordsByType`, not `_typeMap` (which would create a collection). `MUTATION_REVISIONS` (D125, model.js) answers a different question — which fields changed since a request went out.
- **`_flushSeq`** is the sequence being delivered (0 outside delivery, reset in a `finally`); a view refreshing inside delivery stamps it on `_settleMark` to avoid a second `data()` run for the same batch. A re-entrant `flush()` leaves 0 for the outer loop — it loses the dedupe, never a notification.

## Persistence

Opt-in `options.storage`. `_load()` runs in the constructor and is fail-soft including the `_hydrateAll` walk (an escape would blank the page on every reload): what hydrated is kept, the rest dropped with a warning. The HMR restore calls `_hydrateAll` directly (`{ replace: true }`, in place) and propagates errors. The wire shape is `type → [toJSON() + __synced]`; the out-of-band `__synced` marker restores provenance, and a markerless blob hydrates as synced. Mutations only mark dirty; the O(store) write runs once per `flush()` after delivery, and `PuzzleApp` flushes on `pagehide` and at teardown. All merges use [[COMPONENT-PUZZLE-MODEL]]'s safe merge helper.

**Cost:** `_persistNow()` serializes every record of every type per dirty flush. At 10,000 records that is tens of milliseconds per painted frame, and a sustained write load spends most of its time serializing; a full-quota error is swallowed ([[DOC-STRESS-EXAMPLE]]).
