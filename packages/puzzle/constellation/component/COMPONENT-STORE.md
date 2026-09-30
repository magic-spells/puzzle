---
name: Store
status: verified
connections:
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-DEVSTATE
  - FLOW-REACTIVITY
  - FILE-STORE
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Store

Reactive record registry (`datastore/store.js`) for the configured model classes. The
author-facing contract is [[DOC-SPEC-DATA]] §8; server sync is [[COMPONENT-ADAPTER]].

## Records and identity

- `createRecord` applies defaults, generates/honors the primary key, validates, rejects
  duplicates, indexes, and schedules notifications. A `.primary().required()` key is NOT
  auto-generated on `createRecord` (so validation rejects a blank one, matching
  `Model.validate()`); hydration (`_load`) and server upserts (`_upsert`) keep
  `validate = false` and still generate a missing key, fail-soft.
- **Identity is number/string-insensitive** ([[DECISION-D112-STORE-ID-KEY-NORMALIZATION]]):
  every id-keyed index access and both sides of `hasMany`'s FK filter go through one
  `recordKey` helper (numbers → string; `'01'` ≠ `1`; fields keep their type).
- `modelFor(type)` resolves OWN properties only — `models` is a plain object, and a
  persisted key like `"constructor"` must not resolve to `Object`.
- `removeRecord` (core) flags `_deleted` before detaching — one terminal state shared by
  local `destroy()` and confirmed delete, so stale references can't `save()` a copy back.
- Dev-only registration guards (reserved `__synced`, method-name schema entries) live in
  module-level `assertModelSchemas`, not in class methods — esbuild never drops class
  members.

## Finds and tracking

- `findOne`/`findMany` on the core Store are plain local reads. The fault-in pair
  `_findOneTracked`/`_findManyTracked` is grafted on by the adapter module and takes the
  evaluation's request map as a PARAMETER ([[DECISION-D161-AUTO-FETCHING-FINDS]]). Core's
  D161 share is only the `HANDLE_CTX` symbol with its install/restore in
  `withTracking`/`unsubscribe`, and the `_findOneLocal`/`_findManyLocal` split.
- **`this._a = options.adapter`** is the per-store gate: `installAdapter()` copies methods
  onto the prototypes once per REALM and never removes them, so method presence can't say
  whether THIS app opted in. `withTracking` looks up the subscriber's handle context only
  when `_a` is set; `_handleFor`/`_deriveCtx` return null/undefined without it. **Tests of
  the fault path must pass `adapter` in Store options AND read through
  `store._handleFor(subscriber)`** — a raw `store.findOne` is always local.
- `withTracking(subscriber, fn, expectsAsync, pending, requests)` records collection and
  record-key reads; retracking replaces subscriptions. `pending` is the D146 held eval
  (reconcile parked; `_heldKeys` fences those keys from other evals' GC,
  [[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). `requests` is installed on
  `subscriber[HANDLE_CTX]` — the Store has no ambient request slot — with save/restore
  stack discipline. `unsubscribe()` clears it; the restore is skipped only when the
  subscriber `isDestroyed` (read live — `playOut()` unsubscribes a live view that may come
  back).
- **Async tracking serializes**: sync scopes nest inline, but there is one store-wide
  `_asyncTrackingChain`, so any `AsyncFunction` `data()` takes its turn (20 independent
  async evals measured 1-of-20 in flight). A sync-shaped function returning a Promise
  while another async scope is active is retried, so `data()` must be safe to rerun.
- Relationship getters (installed at construction) use the `_find*Local` reads: reactive,
  never fetching (D49/D161). A record holds the raw Store, so a getter has no handle.

## Notification delivery

- `_pendingKeys` is a `Map<key, seq>` stamped from a monotonic `_notifySeq` (bumped once
  per `_notify`); anything sampling it (testing/settled.js, devperf) iterates `.keys()`.
- `_deliverNotifications` is two-phase: gather `Map<subscriber, highest seq>`, then call
  `sub.onStoreChange(seq)` (function subscribers get no argument). Subscribers ADDED
  mid-delivery are not notified for that batch; subscribers REMOVED mid-delivery are
  re-checked against `keysBySubscriber` and skipped (the only guard a plain
  `subscribe(fn)` has).
- `flush()` notifies each subscriber once in isolation, observes thenable failures,
  continues past throws, then (dev) reports the batch to the D100 bridge
  ([[FILE-DEVTOOLS]]) behind an inline probe. Scheduling: rAF when visible plus a 220 ms
  fallback timer; timers directly when hidden/non-DOM.
- **Render revision** (D170, `renderRev.js`): `_notify(type, id)` stamps its sequence
  onto the record under the `RENDER_REV` Symbol (defined non-enumerable at
  `_instantiate`, value 0, one hidden class). Every observable mutation funnels through
  `_notify`, so the revision never advances independently. A removal misses the lookup
  (deleted before notify), and the lookup uses `recordsByType`, not `_typeMap` (which would
  create a collection). `MUTATION_REVISIONS` (D125) answers a different question.
- **`_flushSeq`** is the batch sequence being delivered (0 outside delivery, reset in a
  `finally`); a view refreshing inside delivery stamps it on `_settleMark` to dedupe. A
  re-entrant `flush()` leaves 0 for the outer loop — loses the dedupe, never suppresses.
- D121 profiling (causal chains, flush duration, async deferrals) keeps all state in
  [[FILE-DEVPERF]]; every touchpoint is an inline dev probe.

## Persistence

Opt-in `options.storage`. Hydration is fail-soft INCLUDING the `_hydrateAll` walk
(`_load()` runs in the constructor, so an escape would blank the page on every reload):
what hydrated is kept, the rest dropped with a warning; hydration also sweeps the D161
negative cache. The HMR restore calls `_hydrateAll` directly and propagates. The wire
shape carries an out-of-band `__synced` marker; D161 read state is never persisted.
Mutations only mark dirty; the O(store) write runs once after delivery in `flush()`, and
`PuzzleApp` flushes after router teardown and on `pagehide`. All merges use
[[COMPONENT-PUZZLE-MODEL]]'s safe merge helper.

**Measured cost** ([[DOC-STRESS-EXAMPLE]], [[DECISION-D128-BENCHMARK-METHODOLOGY]]):
`_persistNow()` serializes every record of every type per dirty flush — at 10,000 records
(~2.5 MB) one serialize adds ~35 ms to the painted frame, and a sustained write load
spends ~95% of wall clock serializing (a lower bound; the quota error is swallowed).
