---
name: Store
status: built
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
verified_at: '2026-07-25T05:23:37.483Z'
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

# Store

Reactive record registry for the configured model classes. `createRecord`
applies defaults, generates/honors the model primary key, validates, rejects
duplicates, indexes the instance, and schedules notifications. `findOne` and
`findMany` support identity lookup and collection filtering; record
`update()`/`destroy()` call back into the Store. Record identity is
number/string-insensitive ([[DECISION-D112-STORE-ID-KEY-NORMALIZATION]]):
every id-keyed access to the record index — and both sides of `hasMany`'s FK
filter — normalizes number ids to their string form via one `recordKey`
helper, matching the string identity the subscription keys and adapter URLs
always had. Record fields keep their original type; only numbers normalize
(`null`/objects stay SameValueZero, `'01'` ≠ `1`), and `save()`'s response-pk
comparison uses the same rule so a numeric echo of a string-keyed id merges
instead of warning.

`withTracking(subscriber, fn, expectsAsync, pending)` records collection and
record-key queries performed by `data()`. Retracking replaces subscriptions;
destroying a view unsubscribes it. The optional `pending` channel is the D146
held eval: a successful run parks its reconcile there instead of applying it,
so the router's prepare/commit decides whether the run's keys replace the
last-good set or are unwound, while `_heldKeys` fences those keys from any
other eval's garbage collection until that decision lands
([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). Scope restore is never
deferred, and a failing run reconciles immediately. `flush()` snapshots affected subscribers, notifies each
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

Adapter reads (`loadAll`, `loadOne`) shape-check before mutation and upsert by
primary key while preserving record identity. Public `upsert(type, objectOrArray)`
is the same merge for server-authoritative payloads the app already holds (the
companion to `request()`): existing records update in place, new ones instantiate
validation-exempt and synced. Every payload must be a JSON object carrying an
explicit primary key — the guard that keeps a phantom generated-id record from
being marked synced and PUTting to a nonsense URL; arrays preflight every element
before any mutation and persist once. Writes serialize per record across BOTH
verbs — `saveRecord` and `deleteRecord` share one `_writeChains` chain via
`_chain(record, fn)` (D132), each link reading record state when it reaches the
front — validate first, POST unsynced records and PUT synced records, adopt
server keys atomically, protect against destroy/replacement/collision races, and
throw `PuzzleAdapterError` for adapter failures. Confirmed delete accepts 2xx or
404; a never-synced record's `delete()` removes locally with no request, an
already-`_deleted` one resolves idempotently, and `_saveRecordNow` re-checks
`_deleted` at run time so a queued save cannot resurrect a removed record's row;
`request()` covers custom endpoints. `removeRecord` flags the instance
`_deleted` before detaching it — one terminal state shared by local `destroy()`
and confirmed `delete()`, so stale references delete idempotently and can never
`save()` a resurrected copy.

Every adapter request funnels through private `_fetch` (the D91 `beforeRequest`
hook runs there), which delegates the actual network call to `_network(url,
init, context)` — a trivial `fetch` passthrough that exists as the ONE
sanctioned interception seam (D98): the `/fixtures` module's mock adapter
replaces it at install time, strictly after the hook has shaped the init. The
store itself knows nothing about fixtures — `seed()`/`resetFixtureSeed()` are
prototype-attached by `installFixtures()` and absent otherwise.

Relationship getters are installed on model prototypes at Store construction.
Their queries use the same tracking path as explicit Store calls.

Optional Storage hydration is fail-soft, and that guarantee has to cover the
hydration walk itself, not just the read+parse: `_load()` runs from the
constructor, so anything escaping it escapes `PuzzleApp` construction too and
leaves a permanently blank page — one that survives reload, because the bad blob
is still in storage. `_hydrateAll`'s own guards only cover shapes it recognises,
so the call sits inside the same try/catch; whatever hydrated before the failure
is kept and the rest of the blob is dropped with a warning. The HMR restore path
calls `_hydrateAll` directly and still propagates — that one is developer-facing.
The persisted wire shape includes an out-of-band `__synced` marker while record
JSON remains clean. Mutations only
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
