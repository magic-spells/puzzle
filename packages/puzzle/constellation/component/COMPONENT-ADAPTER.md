---
name: Server adapter runtime (@magic-spells/puzzle/adapter)
status: verified
connections:
  - FILE-ADAPTER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-SSG
  - COMPONENT-FIXTURES
  - COMPONENT-TESTING
  - FLOW-ADAPTER-SYNC
  - STATE-RECORD
  - FILE-STORE
  - FILE-PUZZLE-MODEL
  - FILE-STATIC-MOUNT
  - FILE-PACKAGE
  - DOC-SPEC-DATA
  - DOC-DATASTORE
  - DOC-RELEASE-SURFACE
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - DECISION-D132-CROSS-VERB-WRITE-CHAIN
  - DECISION-D137-LOAD-PK-GUARD
  - DECISION-D138-LOAD-REVISION-MERGE
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D161-AUTO-FETCHING-FINDS
verified_at: '2026-08-24T05:28:13.551Z'
verified_sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
---

# Server adapter runtime

The `@magic-spells/puzzle/adapter` subpath (`datastore/adapter.js`): the whole server
read/write implementation, with no import side effects. Its one outward effect is the
frozen capability value an app passes once as `PuzzleApp`'s `adapter` config
([[DECISION-D157-ADAPTER-SUBPATH]]). [[FLOW-ADAPTER-SYNC]] owns the request pipeline,
[[STATE-RECORD]] what each verb does to a record, [[DOC-SPEC-DATA]] §22/§49/§58/§61 the
author contract. This card owns the module's install contract, seams and surprises.

## Install

`installAdapter()` copies three method bags onto the core prototypes, once per realm
(first call wins; never un-installed, since concurrent apps share them):

- [[COMPONENT-STORE]]: `adapter(type)`, `loadMany`, `loadOne`, `upsert`, `saveRecord`,
  `deleteRecord`, `request`, the tracked read pair and `_faultOne`/`_faultMany`,
  `_handleFor`, `_deriveCtx`, and the `beforeRequest`/network seams.
- [[COMPONENT-PUZZLE-MODEL]]: `save()`, `delete()`.
- [[COMPONENT-PUZZLE-VIEW]]: `_settleData`, the D161 settle executor.

**Method presence never means "this app opted in".** The store's own capability
(`store._a`) does: PuzzleView takes the settle loop on `store._a && this._settleData`,
and `withTracking` installs a request map only when `_a` is set, so the fault path is
unreachable for a capability-free store (`tests/adapter-realm-isolation.test.js`).
[[COMPONENT-PUZZLE-APP]] rejects a truthy non-capability `adapter`, installs before
constructing the Store, and dev-warns when a model declares `static adapter` with no
capability. `/static` and the testing helpers validate-and-install through the same check.

## The per-view handle (D161 attribution)

`_handleFor(subscriber)` is a `Proxy` over the raw Store, memoized in one WeakMap per
subscriber (a subscriber belongs to one store). Its `findOne`/`findMany` route to the
tracked pair with the subscriber's open request map; **every other forwarded method is
bound to the RAW store**, because `this === raw store` keys the read-state WeakMaps and
reaches `_a`, `_asyncTrackingChain`, `_typeMap` and the subscription maps. `_deriveCtx`
wraps it in the per-view ctx. Both return null/undefined without the capability.

## Per-Store state

The dialect (the capability's `defaults()` functions) is retained on the Store. D161
read state lives in module-level WeakMaps keyed by Store: in-flight record requests
(type + `recordKey(id)`), in-flight collection requests (type), a 1000-entry
insertion-ordered negative LRU, and two type sets — LOADED and EXHAUSTIVE. Implicit
faults dedup against in-flight maps; explicit `loadOne`/`loadMany` always request, and
explicit `loadOne` bypasses (but refreshes) the negative cache. Per-record write chains
also live in a WeakMap keyed by Store.

## Surface

- `store.adapter(type)`: the model's declared functions plus the five standard verbs
  backfilled from app defaults, then generated REST ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]:
  model → app default → REST; app defaults also receive `{ type, endpoint }`), all
  pre-bound to one memoized enhanced fetch per Store+type. **Memoized on first use** — a
  later rewrite of `static adapter` is not seen by that Store. The enhanced fetch is
  platform-shaped (no URL prefixing, no JSON parsing); it adds only the `beforeRequest`
  hook (`_fetch`, D91) and the `_network` seam.
- `PuzzleAdapterError` (`status`, `statusText`, parsed-or-raw `body`): generated reads
  normalize non-OK through it; the negative cache records absence on exactly
  `status === 404`.
- `adapter.defaults({...verbs})` returns a second capability. Only the bare export has
  `defaults()` — the readable "configured" test the static build uses without importing
  this module.
- `serializeReadState`/`hydrateReadState`: envelope `{ v: 1, complete, loaded, absent }`
  (`complete` ⊆ `loaded`). Records hydrate first; hydrate drops absences whose record is
  present, reads a `loaded`-less envelope as `loaded === complete`, ignores unknown
  versions. The static kernel and devstate reach them through the `capabilities.js`
  relay (`registerReadState`), never importing this module.
- Dev validation warns on bad model adapter keys (only `endpoint`, `mock`, functions)
  and bad `defaults()` keys. `loadAll` throws in production too, everywhere it can
  appear, naming `loadMany`. Dev also warns once per store+verb when a view calls
  `loadOne`/`loadMany` through its OWN handle during its own tracked evaluation.

## Invariants

- **Core owns no server verbs and never imports this module**; it holds the capability
  opaquely. Without it: no `loadMany`, `upsert`, `save()`/`delete()`, write chain, settle
  loop or error class — calling one is "not a function".
- **One network seam**: generated transports, author functions using the fetch they were
  handed, and `request()` all funnel through the same hook and network call (what dev and
  test tooling replaces).
- **The hook may not move method or body**: a returned init is shallow-copied before
  method/body are re-stamped, so frozen or getter-only objects work.
- **A body is read exactly once**, JSON preferred, text preserved, empty = absent.
- **In-flight entries clear in `finally` with an identity check, and every fault promise
  has a rejection observer** — no unhandled rejections or stuck keys.
- **Removal records absence newer than every in-flight read**: `removeRecord` stamps the
  absence one step ahead of the read-dispatch counter; an older response for that
  identity is dropped in `_upsert`, and a record created meanwhile inherits the stamp.
- **A faulted `loadOne` must return the requested record** (pk compared by `recordKey`)
  or it rejects before mutation. Explicit `store.loadOne` is permissive and clears the
  id's negative entry on success.

## Gotchas

- LOADED vs EXHAUSTIVE: a successful no-options collection load (`null` counts,
  `{}` does not) marks LOADED — so tracked `findMany` stops re-requesting. It marks
  EXHAUSTIVE (a `findOne` miss answers `null` without a request) ONLY when the generated
  REST transport made the request; an authored or `defaults()` `loadMany` may be page one.
  `loadOne`, `createRecord`, `upsert`, `save`, hydration and options-bearing loads mark
  neither; an empty-array REST success marks both.
- The `mock` key is allow-listed for [[COMPONENT-FIXTURES]], which also imports and
  installs this module itself before replacing the network seam.
- `request()` resolves its URL from `endpoint`, so it requires one even when all five
  verbs are author functions.
- Only the generated transports are REST-specific; validation, identity, ordering,
  reconciliation and notification don't change when every verb is replaced.
- Prerender reads run on the build machine: an absolute `apiURL` is fetched for real, a
  model with no `endpoint`/read verb never faults (seed in `beforeMount`), and an
  app-relative URL fails the build — there is no build-time server.
