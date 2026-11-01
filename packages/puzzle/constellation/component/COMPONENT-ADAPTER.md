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
  - FILE-STATIC-MOUNT
  - DOC-SPEC-DATA
  - DOC-DATASTORE
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D138-LOAD-REVISION-MERGE
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D185-APP-IDLE
verified_at: '2026-11-01T19:23:56.488Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Server adapter runtime

The `@magic-spells/puzzle/adapter` subpath (`client-runtime/datastore/adapter.js`): the whole server read/write implementation, with no import side effects. Its one outward effect is the frozen capability an app passes once as `PuzzleApp`'s `adapter` config ([[DECISION-D157-ADAPTER-SUBPATH]]). [[FLOW-ADAPTER-SYNC]] owns the request pipeline, [[STATE-RECORD]] what each verb does to a record, [[DOC-SPEC-DATA]] §22/§49/§58/§61 the author contract. This card owns the install contract, seams and surprises.

## Install

`installAdapter()` copies three method bags onto the core prototypes, once per realm (never un-installed, since concurrent apps share them):

- [[COMPONENT-STORE]]: `adapter(type)`, `loadMany`, `loadOne`, `upsert`, `saveRecord`, `deleteRecord`, `request`, the tracked read pair and `_faultOne`/`_faultMany`, `_handleFor`, `_deriveCtx`, `_reading` (asked by `app.idle()`, [[DECISION-D185-APP-IDLE]]), the `_fetch`/`_network` seams, and a `loadAll` trap. It also **wraps** `createRecord`, `removeRecord`, `_hydrateAll` and `_installRelationships` (captured before install) to keep D161 read state current and to reject an unrenamed `loadAll` at Store init.
- [[COMPONENT-PUZZLE-MODEL]]: `save()`, `delete()`.
- [[COMPONENT-PUZZLE-VIEW]]: `_settleData`, the D161 settle loop.

**Method presence never means "this app opted in".** The store's own capability (`store._a`) does: PuzzleView takes the settle loop on `store._a && this._settleData`, and `withTracking` installs a request map only when `_a` is set (`tests/adapter-realm-isolation.test.js`). [[COMPONENT-PUZZLE-APP]] rejects a truthy non-capability `adapter`, installs before constructing the Store, and dev-warns when a model declares `static adapter` with no capability. SSG, `/static`, `/testing` and `/fixtures` validate-and-install through `capabilities.js`'s `installAdapterCapability`.

## The per-view handle (D161 attribution)

`_handleFor(subscriber)` is a `Proxy` over the raw Store, memoized per subscriber (a subscriber belongs to one store). Its `findOne`/`findMany` route to the tracked pair with the subscriber's open request map; **every other method is bound to the RAW store**, because `this === raw store` keys the read-state WeakMaps and reaches `_a`, `_asyncTrackingChain`, `_typeMap` and the subscription maps. Bindings re-bind when the underlying function changes (`installFixtures()` swaps `_network` mid-session). `STORE_RAW` on a handle returns the raw Store. `_deriveCtx` builds the per-view ctx: `Object.create(appCtx)` with only `store` overridden, always chained off the base ctx so nesting stays two deep. Both return null/undefined without the capability, so an adapter-free app keeps `ctx.store === app.store`.

## Fetch eligibility and read state

- **`faultVerb` is stricter than dispatch:** a tracked miss fetches only when the model's own `static adapter` has an `endpoint` or an authored function for the verb. An `adapter.defaults()` dialect binds verbs onto every model, so without this gate a local-only model would fetch `GET /undefined`. Explicit `loadOne`/`loadMany` still dispatch through the dialect.
- **`isGeneratedVerb`** (endpoint present, no model function, no app default) decides EXHAUSTIVE: only a framework-built request can claim that omitted ids do not exist.
- Read state lives in module WeakMaps keyed by Store (D157 keeps it out of core): in-flight record requests (`type + recordKey(id)`), in-flight collection requests (type), a 1000-entry insertion-ordered negative LRU, the LOADED and EXHAUSTIVE type sets, and a monotonic dispatch counter (`seq`). Per-record write chains and `store.adapter()` bindings are WeakMaps keyed by Store too; `LOAD_GENERATIONS` is keyed by record.
- `serializeReadState`/`hydrateReadState`: envelope `{ v: 1, complete, loaded, absent }` (`complete` ⊆ `loaded`). Records hydrate first; hydrate drops absences whose record is present, reads a `loaded`-less envelope as `loaded === complete`, ignores unknown versions, and unwraps a handle. The prerenderer, static kernel and devstate reach them through the `capabilities.js` relay (`registerReadState`), never importing this module.

## Surface

- `store.adapter(type)`: the model's declared functions plus the five standard verbs backfilled model → app default → generated REST ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]; app defaults also receive `{ type, endpoint }`), all pre-bound to one enhanced fetch. **Memoized on first use** — a later rewrite of `static adapter` is not seen by that Store. The enhanced fetch is platform-shaped; it adds only the `beforeRequest` hook (`_fetch`, [[DECISION-D91-ADAPTER-REQUEST-HOOK]]) and the `_network` seam.
- `PuzzleAdapterError` (`status`, `statusText`, parsed-or-raw `body`): generated reads normalize non-OK through it; the negative cache records absence on exactly `status === 404`.
- `adapter.defaults({...verbs})` returns a second capability whose verbs ride as `d`. Only the bare export has `defaults()` — the "configured" test (`isConfiguredAdapter`) the static build reads without importing this module.
- Dev warnings: bad model adapter keys (only `endpoint`, `mock`, functions), bad `defaults()` keys, and a view calling `loadOne`/`loadMany` through its own handle during its own tracked evaluation (once per store+verb; the seam is the handle, because a forwarded method no longer knows which reference the caller held). The `loadAll` trap throws in every build — at Store init, in `store.adapter()`, in `defaults()` and as `store.loadAll()` — steering to `loadMany`.

## Invariants

- **Core owns no server verbs and never imports this module.** Without the capability: no `loadMany`, `upsert`, `save()`/`delete()`, write chain, settle loop or error class — calling one is "not a function".
- **One network seam**: generated transports, author functions using the fetch they were handed, and `request()` all funnel through `_fetch` then `_network` (what fixtures replace).
- **The hook may not move method or body**: a returned init is shallow-copied before method/body are re-stamped, so frozen or getter-only objects work.
- **A body is read exactly once**, JSON preferred, text preserved, empty = `undefined`. Response detection is `instanceof Response` or the `Symbol.for('puzzle.response')` brand the fixtures mock carries.
- **In-flight entries clear in `finally` with an identity check, and every fault promise has a rejection observer** — no unhandled rejections or stuck keys.
- **Removal records absence newer than every in-flight read** ([[DECISION-D138-LOAD-REVISION-MERGE]]): the wrapped `removeRecord` stamps the absence at `++seq`; `_upsert` drops an older-generation response for that identity, and a record created meanwhile inherits the stamp.
- **A faulted `loadOne` must return the requested record** (compared by `recordKey`) or it rejects before mutation. Explicit `store.loadOne` is permissive and clears the requested id's negative entry on success.

## Gotchas

- LOADED marks on a successful no-options load (`undefined`/`null` options count, `{}` does not), so tracked `findMany` stops re-requesting. EXHAUSTIVE needs the generated transport too. `loadOne`, `createRecord`, `upsert`, `save`, hydration and options-bearing loads mark neither; an empty-array REST success marks both.
- The `mock` key is allow-listed for [[COMPONENT-FIXTURES]], which installs this module itself before replacing `_network`.
- `request()` resolves its URL from `endpoint`, so it requires one even when all five verbs are author functions.
- Only the generated transports are REST-specific; validation, identity, ordering, reconciliation and notification are the same when every verb is replaced.
- Prerender reads run on the build machine: an absolute `apiURL` is fetched for real, a model with no `endpoint`/read verb never fetches (seed in `beforeMount`), and an app-relative URL fails the build ([[COMPONENT-SSG]]).
