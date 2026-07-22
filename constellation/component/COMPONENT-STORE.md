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
      Synchronous tracking scopes may nest and always run inline. Truly async
      tracking evaluations serialize because the Store has one mutable tracking
      scope. A sync-shaped function that returns a Promise while another async
      scope is active is retried; data() must remain safe to rerun.
verified_at: '2026-07-22T00:04:07.883Z'
---

# Store

Reactive record registry for the configured model classes. `createRecord`
applies defaults, generates/honors the model primary key, validates, rejects
duplicates, indexes the instance, and schedules notifications. `findOne` and
`findMany` support identity lookup and collection filtering; record
`update()`/`destroy()` call back into the Store.

`withTracking(subscriber, fn, expectsAsync)` records collection and record-key
queries performed by `data()`. Retracking replaces subscriptions; destroying a
view unsubscribes it. `flush()` snapshots affected subscribers, notifies each
once in isolation, observes thenable failures, and continues after a throwing
subscriber. Scheduling uses rAF when visible plus a 220ms fallback, and timers
directly in hidden/non-DOM contexts.

Adapter reads (`loadAll`, `loadOne`) shape-check before mutation and upsert by
primary key while preserving record identity. Writes serialize concurrent saves
per record, validate first, POST unsynced records and PUT synced records, adopt
server keys atomically, protect against destroy/replacement/collision races, and
throw `PuzzleAdapterError` for adapter failures. Confirmed delete accepts 2xx or
404; `request()` covers custom endpoints.

Relationship getters are installed on model prototypes at Store construction.
Their queries use the same tracking path as explicit Store calls.

Optional Storage hydration is fail-soft. The persisted wire shape includes an
out-of-band `__synced` marker while record JSON remains clean. Mutations only
mark persistence dirty; the O(store) serialization/write runs once after
subscriber delivery in `flush()`. `PuzzleApp` forces a final flush after router
teardown and holds a window `pagehide` listener that flushes while mounted, so
a reload or navigation racing the scheduled flush cannot lose the last
mutations. HMR can hydrate in identity-preserving replace mode before
navigation zero.

All server/storage merges use [[COMPONENT-PUZZLE-MODEL]]'s safe merge helper;
malformed entries and protected keys cannot corrupt live records.
