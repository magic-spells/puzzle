---
name: Store
status: verified
connections:
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-DEVSTATE
  - FLOW-REACTIVITY
  - FILE-STORE
notes:
  - kind: gotcha
    text: >-
      Synchronous tracking scopes may nest and always run inline. Truly async tracking evaluations
      serialize because the Store has one mutable tracking scope. A sync-shaped function that
      returns a Promise while another async scope is active is retried; data() must remain safe to
      rerun.
  - kind: state
    text: >-
      createRecord ↔ Model.validate() primary-key parity (2026-07-24, FEATURE-VALIDATE-PK-PARITY).
      Store._instantiate auto-generated a missing pk BEFORE §20 validation, so a blank
      `.primary().required()` key was silently filled and never rejected — even though
      Model.validate() rejects it (model.js explicitRequired). Fix: skip pk auto-generation when the
      pk field def is explicitRequired AND validate is true (i.e. createRecord), letting the D48
      validation throw the required error exactly as validate() does. Hydration (_load) and server
      upserts (_upsert) keep validate=false and STILL auto-generate a missing pk (fail-soft /
      server-authoritative — must not crash on a missing key). Plain `.primary()` still
      auto-generates. Tests: tests/validation.test.js 'createRecord primary-key parity'.
    sha: d9591d6
  - kind: verified
    text: >-
      Re-verified after D112: recordKey index normalization reviewed line-by-line against the card's
      identity-rule paragraph; store suites + full runs green at merged main.
    sha: 11f64be1b6828318f5085a5dc16ebe8f53ebfbd4
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
  - kind: state
    text: >-
      Per-store adapter gate (2026-08-30). `installAdapter()` copies the adapter methods onto
      Store/PuzzleModel/PuzzleView prototypes ONCE PER REALM and never removes them (concurrent apps
      depend on that), so method presence cannot say whether THIS app opted in. The store's own
      capability does: `this._a = options.adapter`, set from what PuzzleApp.mount() passed. It gates
      every half of the D161 seam: `withTracking()` looks up the subscriber's handle context only
      when `this._a` is truthy — one check per evaluation, not per query — and
      `_handleFor()`/`_deriveCtx()` return null/undefined without it, so an adapter-free app mints
      no handle and its views keep `ctx.store === app.store`. `findOne`/`findMany` cannot fault on
      such a store in any case: the raw finds are plain local reads and the tracked pair is
      adapter-installed. Tests that want the settle/fault path must pass `adapter` in the Store
      options the way the app does, AND read through `store._handleFor(subscriber)` — a raw
      `store.findOne` is always local. Regression: tests/adapter-realm-isolation.test.js,
      tests/tracked-read-attribution.test.js.
  - kind: state
    text: >-
      Notifications carry ORDER, not just identity (0.7.0, D161 follow-up). `_pendingKeys` is a
      Map<key, seq> stamped from a monotonic `_notifySeq` bumped once per `_notify`.
      `_deliverNotifications` runs in two phases. Phase one gathers Map<subscriber, highest seq
      among the keys it holds in this batch>; phase two calls `sub.onStoreChange(seq)`, so a
      subscriber can recognise a batch that was already enqueued when the evaluation behind its
      committed model began and skip it — which is how a settle run's own upsert flush stopped
      buying a redundant third `data()` run. Two delivery rules follow from the split and both are
      load-bearing. Subscriber sets are read in phase one, before any subscriber runs: a subscriber
      ADDED mid-delivery (a child mounted by another subscriber's data()) is not notified for that
      batch. Membership is re-checked at call time against `keysBySubscriber`: a subscriber REMOVED
      mid-delivery — one that an earlier subscriber in the same batch unsubscribed — is not called.
      The re-check is the only protection a plain `store.subscribe(fn)` callback has, since it
      carries no destroyed-guard of its own; regression is
      tests/settle-notification-delivery.test.js 'does not call a subscriber an earlier subscriber
      unsubscribed in the same batch'. The dev-only `keys`/`notified` bookkeeping for the DevTools
      probe is built inside the `__PUZZLE_DEV__` gate so production allocates neither.
      `_pendingKeys` is a Map now, so anything sampling it (client-runtime/testing/settled.js,
      devperf) must iterate `.keys()`. Function subscribers still receive no argument.
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Store

Reactive record registry for the configured model classes. `createRecord`
applies defaults, generates/honors the model primary key, validates, rejects
duplicates, indexes the instance, and schedules notifications. `findOne` and
`findMany` support identity lookup and collection filtering, and on the core
Store they are exactly that — plain local reads with no fault branch in them at
all. The fault-in half is `_findOneTracked`/`_findManyTracked`, grafted on by
the adapter module beside `_faultOne`/`_faultMany`; each takes the open
evaluation's request map as a PARAMETER, and a miss with a map returns its
local value synchronously while adding a deduped fetch promise to that pending
set ([[DECISION-D161-AUTO-FETCHING-FINDS]]). Only a store handle calls them,
and only a read through the reading view's own handle, during that view's own
`data()` run, ever carries a map. Nullish/unkeyable ids, collection-complete
types, known-absent identities, and models that declare no `adapter` endpoint
or read function of their own stay pure-local regardless — an app-wide
`adapter.defaults()` dialect never turns a local-only model into a fetching
one. Record `update()`/`destroy()` call back
into the Store. Record identity is
number/string-insensitive ([[DECISION-D112-STORE-ID-KEY-NORMALIZATION]]):
every id-keyed access to the record index — and both sides of `hasMany`'s FK
filter — normalizes number ids to their string form via one `recordKey`
helper, matching the string identity the subscription keys and adapter URLs
always had. Record fields keep their original type; only numbers normalize
(`null`/objects stay SameValueZero, `'01'` ≠ `1`), and `save()`'s response-pk
comparison uses the same rule so a numeric echo of a string-keyed id merges
instead of warning.

`withTracking(subscriber, fn, expectsAsync, pending, requests)` records
collection and record-key queries performed by `data()`. Retracking replaces
subscriptions; destroying a view unsubscribes it. The optional `pending`
channel is the D146 held eval: a successful run parks its reconcile there
instead of applying it, so the router's prepare/commit decides whether the
run's keys replace the last-good set or are unwound, while `_heldKeys` fences
those keys from any other eval's garbage collection until that decision lands
([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). The `requests` channel is
the D161 pending set. It is installed on the SUBSCRIBER'S handle context
(`subscriber[HANDLE_CTX]`, looked up only when this store carries the
capability), never on the Store — the Store has no ambient
request slot at all — with the same save/restore stack discipline as the
tracking scope itself, so the map is reachable only by that subscriber's own
handle and only for the extent of that evaluation. A subscriber with no handle
context (a bare object, an adapter-free app) installs no map anywhere and its
reads are local. `unsubscribe()` clears the context's map so a torn-down view's
suspended evaluation stops faulting, and the restore on the way out is skipped
only when the subscriber is DESTROYED — read live from `isDestroyed`, never
latched by `unsubscribe()` itself, because `playOut()` unsubscribes a LIVE view
that `_restoreFromLeaving()` can bring back and refresh. Scope restore is never
deferred, and a failing run reconciles
immediately. `flush()` snapshots affected subscribers, notifies each
once in isolation, observes thenable failures, and continues after a throwing
subscriber. Scheduling uses rAF when visible plus a 220ms fallback, and timers
directly in hidden/non-DOM contexts. In dev builds `flush()` closes by reporting
the batch to the D100 DevTools bridge ([[FILE-DEVTOOLS]]) — the changed keys and
the exact subscriber set notified — placed after the delivery loop because only
then are both halves final. The probe is spelled inline so production DCE folds
the statement and the import tree-shakes away.

D121 propagates causal chains through `_notify`/`flush`, records whole-flush
duration plus key/subscriber counts, and measures both known-async and
sync-shaped `_asyncTrackingChain` head-of-line deferrals. Store owns no profiler
state; [[FILE-DEVPERF]] holds it and every Store touchpoint is an inline positive
development probe.

`modelFor(type)` resolves **own properties only**. `models` is a plain object
literal, so a bare index also reaches `Object.prototype`: a persisted blob keyed
`"constructor"` would return `Object` — truthy, so it wins over the
`PuzzleModel` fallback — and the caller's `primaryKey()` would throw on a path
that must stay fail-soft.

The core Store owns no server verbs. Passing the `adapter` capability from
`@magic-spells/puzzle/adapter` to `PuzzleApp` installs `loadMany`, `loadOne`,
`adapter`, `upsert`, `saveRecord`, `deleteRecord`, `request`, the tracked read
pair, `_handleFor`, `_deriveCtx`, and
their private helpers on its prototype ([[DECISION-D157-ADAPTER-SUBPATH]]);
`loadAll` — the pre-0.7.0 spelling — is a throwing trap naming `loadMany`.
`_handleFor(subscriber)` is the D161 attribution channel: a memoized `Proxy`
over the raw Store whose `findOne`/`findMany` route to the tracked pair with
the subscriber's open request map, and which binds every other forwarded method
back to the RAW store, because `this === the raw Store` is what keys
`readStateFor`'s WeakMap and reaches `_a`, `_asyncTrackingChain`, `_typeMap`
and the subscription Maps. It is memoized in one `WeakMap` keyed by subscriber,
matching the single `HANDLE_CTX` slot a subscriber carries: a subscriber
belongs to exactly one store, which is what a PuzzleView is. `_deriveCtx`
wraps the handle in the per-view ctx [[COMPONENT-PUZZLE-VIEW]] reads through.
Both return null/undefined without the capability, which is how
an adapter-free app keeps `ctx.store === app.store`. Core's own share of
D161 is deliberately tiny: the `HANDLE_CTX` symbol and its install/restore in
`withTracking`/`unsubscribe`, and the
`_findOneLocal`/`_findManyLocal` split — every decision (verb
resolution, in-flight dedup, the negative LRU, collection completeness, the
tracked reads, the handle, the derived ctx) lives in the adapter module. Under
[[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]], a model's adapter is per-verb fetch
functions. Dispatch resolves the model's own function first, the app
capability's `adapter.defaults()` function second, and endpoint-generated REST
transport last. App defaults receive `{ type, endpoint }` after the normal verb
arguments; model functions keep their original signatures. Store retains the
opaque capability value but never imports its module. It dispatches transport,
then owns Response normalization, shape/key guards, and all reconciliation.
Reads preserve identity and accumulate paginated loads; writes serialize per
record across save and delete using adapter-module `WeakMap` state keyed by
Store. The installed implementation
validates before sync, adopts server keys atomically, protects against
destroy/replacement/collision races, and throws the subpath's
`PuzzleAdapterError` for adapter failures — generated reads included, which is
what lets the D161 negative cache key off a normalized 404. `removeRecord`
stays in core and flags the instance
`_deleted` before detaching it — one terminal state shared by local `destroy()`
and confirmed `delete()`, so stale references delete idempotently and can never
`save()` a resurrected copy.

The installed adapter constructs one memoized enhanced fetch per Store+type and
pre-binds it to every function exposed by `store.adapter(type)`, including the
five generated defaults. Its signature and Response result match platform
fetch; it does not prefix URLs or parse JSON. It funnels through `_fetch` (the
D91 `beforeRequest` hook runs there) and delegates the network call to
`_network`. The `/fixtures` module imports and installs the adapter capability
so that seam exists, then replaces it at install time strictly after the hook
shapes the init. Global fetch bypasses both additions by design. Core knows
nothing about either module; `seed()`/`resetFixtureSeed()` are likewise absent
unless fixtures are installed.

Relationship getters are installed on model prototypes at Store construction.
Their queries use `_findOneLocal`/`_findManyLocal` — the same subscription keys
as the public finds, no fault-in — so a traversal is reactive but can never
issue a request (D49/D161). This is also why subscription attribution stays
ambient while faulting moved to identity: a record holds the raw Store, so a
relationship getter has no handle to read through.

Optional Storage hydration is fail-soft, and that guarantee has to cover the
hydration walk itself, not just the read+parse: `_load()` runs from the
constructor, so anything escaping it escapes `PuzzleApp` construction too and
leaves a permanently blank page — one that survives reload, because the bad blob
is still in storage. `_hydrateAll`'s own guards only cover shapes it recognises,
so the call sits inside the same try/catch; whatever hydrated before the failure
is kept and the rest of the blob is dropped with a warning. Hydration also
sweeps the D161 negative cache — an absence whose record just arrived is
dropped. The HMR restore path
calls `_hydrateAll` directly and still propagates — that one is developer-facing.
The persisted wire shape includes an out-of-band `__synced` marker while record
JSON remains clean; D161 read state (completeness, negatives) is never
persisted to app storage. Mutations only
mark persistence dirty; the O(store) serialization/write runs once after
subscriber delivery in `flush()`. `PuzzleApp` forces a final flush after router
teardown and holds a window `pagehide` listener that flushes while mounted, so
a reload or navigation racing the scheduled flush cannot lose the last
mutations. HMR can hydrate in identity-preserving replace mode before
navigation zero.

All server/storage merges use [[COMPONENT-PUZZLE-MODEL]]'s safe merge helper;
malformed entries and protected keys cannot corrupt live records.

## Measured costs

Both figures come from [[DOC-STRESS-EXAMPLE]] under the production harness
([[DECISION-D128-BENCHMARK-METHODOLOGY]]). They describe current behavior; they
are not proposals.

**Persistence is O(store) per mutating frame, not O(changed records).**
`_persistNow()` serializes *every record of every type* through `toJSON()` and
`JSON.stringify`s the result, once per dirty flush. At 10,000 records that blob
is ~2,583 KB. Pricing one serialize by differencing two otherwise identical
5,000-write bursts: script time is unchanged (`_persist()` only sets the dirty
flag) at 11.5ms both ways, while time to the painted frame goes from **16.4ms to
51.2ms** — **+34.8ms for one serialize**, three times what the writes that
triggered it cost. Heap delta for the same op goes 0.9MB → 10.3MB. Under a
sustained write load a 10,000-record store spends **~95% of the wall clock
serializing itself**, and the flush rate drops for the same number of writes.
The reported time is a **lower bound**: the probe uses an in-memory storage shim,
because 2.5MB exceeds the localStorage quota and `_persistNow` swallows the
resulting `QuotaExceededError` — the real `setItem` cost is not included.
Persistence is opt-in (`options.storage`), so this cost is paid only by apps
that asked for it.

**Async tracking serialization is real in production, and it is not a timing
inference.** Twenty independent `async data()` evaluations that share nothing and
query nothing report `maxInFlight` **1 of 20** from an in-page concurrency census
(the census was itself validated against a control of 8 genuinely parallel
promises, which reports 8). Wall time agrees — 20 × 50ms → ~1028ms — but wall
time alone cannot distinguish "serialized" from "slow", which is why the verdict
comes from the census. The cause is the single store-wide `_asyncTrackingChain`
described above; the trigger is the *shape* of `data()` (an `AsyncFunction`), so
a component that awaits and touches no record still takes its turn in the queue.
