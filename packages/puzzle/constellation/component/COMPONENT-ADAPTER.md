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
  - FEATURE-ADAPTER-WRITE-SYNC
  - FEATURE-STORE-PUBLIC-UPSERT
verified_at: '2026-08-24T05:28:13.551Z'
verified_sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
notes:
  - kind: verified
    text: >-
      Invariants + Gotchas re-truthed: removal-records-absence, fault-path-only identity guard, no
      build-time server — PRs #83/#84.
    sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
  - kind: state
    text: >-
      install() stays one-shot per realm; the GATE moved to the store (2026-08-30).
      `installAdapter()` still copies AdapterStoreMethods/AdapterModelMethods/AdapterViewMethods
      onto the shared prototypes behind the module-global `installed` flag, and prototypes are
      deliberately never uninstalled on unmount (concurrent apps in one realm would lose their
      surface). The consequence had to be closed elsewhere: a second app mounted later WITHOUT
      `config.adapter` still saw `_settleData` on PuzzleView.prototype and took the D161 settle
      path, so a model carrying adapter metadata could fault reads that app had opted out of. Both
      seams now gate on the CURRENT store's capability (`store._a`, set from the value
      PuzzleApp.mount() passed): PuzzleView picks the settle loop on `store._a && this._settleData`,
      and Store.withTracking installs the request map only when `_a` is set, which makes
      `_faultOne`/`_faultMany` unreachable for a capability-free store. Regression:
      tests/adapter-realm-isolation.test.js.
---

# Server adapter runtime

The published `@magic-spells/puzzle/adapter` subpath: the entire server
read/write implementation, shipped as a module with no import side effects. Its
whole outward effect is the frozen capability value it exports, which an app
passes **once** as `PuzzleApp`'s `adapter` config field.

[[FLOW-ADAPTER-SYNC]] owns the request pipeline and [[STATE-RECORD]] owns what a
verb does to a record's position. This card owns the module: its install
contract, its surface, the seams other modules attach to, and the ways it can
surprise.

## What installing grafts on

Installing copies three method bags onto the core prototypes as ordinary
property descriptors.

- [[COMPONENT-STORE]] gains `adapter(type)`, `loadMany`, `loadOne`, `upsert`,
  `saveRecord`, `deleteRecord`, `request`, and the private helpers behind them —
  including the `beforeRequest` hook seam and the single network seam beneath it.
- [[COMPONENT-PUZZLE-MODEL]] gains `save()` and `delete()`.
- [[COMPONENT-PUZZLE-VIEW]] gains `_settleData` — the
  [[DECISION-D161-AUTO-FETCHING-FINDS]] settle executor. Core PuzzleView holds
  only the call seam (`!store._a || !this._settleData` at its two entry points —
  refresh and prepareRefresh; preload, mount, and prerender all reach the loop
  through refresh), so a no-adapter app ships none of the loop.

Install is idempotent and realm-global: the first call wins, later ones are
no-ops, and several apps on one page share one installed surface. The
prototypes are never un-installed — a concurrent app would lose its surface —
so METHOD PRESENCE cannot answer "did this app opt in", and nothing may use it
as the test. The store's retained capability answers it instead: PuzzleView
picks the settle loop on `store._a && this._settleData`, and
`Store.withTracking` installs the D161 request map only for a store that
carries the capability, which is what keeps `_faultOne`/`_faultMany`
unreachable for an app that shipped no adapter even though its prototypes carry
them (tests/adapter-realm-isolation.test.js).
[[COMPONENT-PUZZLE-APP]] rejects a truthy `adapter` that is not a capability at
construction time, installs before constructing the Store, and warns in
development when a model declares `static adapter` while no capability was
passed. `@magic-spells/puzzle/static` and the testing helpers validate-and-install
through the same shared check, so a static page or a bare `mountView` gets the
identical surface.

What is *per Store* is the dialect, not the install: the capability object the
app passed is retained on the Store, and verb dispatch reads its app-default
functions from there. Per Store too is the D161 read state, in module-level
`WeakMap`s: in-flight single-record requests keyed type + `recordKey(id)`,
in-flight collection requests keyed by type, a 1000-entry insertion-ordered
negative LRU, and two collection sets — the types whose collection has LOADED,
and the exhaustive subset of those the framework fetched itself. Implicit faults
dedup against the in-flight maps; explicit `loadOne`/`loadMany` always issue a
request, and explicit `loadOne` bypasses the negative cache (the force-refresh
escape hatch — its outcome still refreshes the entry).

`adapter.defaults({ ...verbs })` returns a second capability closing over
app-wide verb functions. Only the bare export still offers `defaults()`, and
that difference is the readable test for "configured" — which is how the static
build classifies an app's adapter without importing this module and dragging the
sync runtime into its graph.

## Surface

`store.adapter(type)` is the author-facing view of a model's adapter: every
function the model declared, pre-bound to an enhanced fetch, plus the five
standard verbs backfilled from the app defaults and then from the
endpoint-generated REST transport. It is memoized per Store and type. The
enhanced fetch is platform-shaped — URL plus init in, `Response` out — and adds
no URL prefixing and no automatic JSON; its only additions are the request hook
and the network seam.

`PuzzleAdapterError` is exported here and carries `status`, `statusText`, and the
parsed-or-raw `body`. Generated read transports normalize non-OK responses
through it (D158) — the D161 negative cache records absence on exactly
`status === 404`; every other failure rejects and poisons nothing.

`serializeReadState(store)` and `hydrateReadState(store, envelope)` are the
D161 read-state codecs — envelope `{ v: 1, complete: [...types],
loaded: [...types], absent: ['type recordKey', ...] }`, where `complete` is the
exhaustive subset of `loaded`. Records hydrate first; hydrate drops any absence
whose record is present, reads a `loaded`-less envelope (written before 0.7.0)
as `loaded === complete`, and ignores unknown versions. A kernel that never
learned about `loaded` still answers every id correctly — it only re-loads the
collection once for a type whose authored `loadMany` was never exhaustive. The
static kernel and devstate reach these codecs through the `capabilities.js`
relay (the adapter registers them there at module scope) so neither ever
imports this module.

Development builds validate two shapes and warn rather than throw: a model's
adapter keys must be `endpoint`, `mock`, or functions (warned once per model
class), and `adapter.defaults()` keys must be the five verb names with function
values. The exception is `loadAll` — the pre-0.7.0 spelling throws in
production too, everywhere it can appear (`store.loadAll()` trap, model key at
Store init, `defaults()` key, verb binding), one message naming `loadMany`.
Development also warns once per store per verb when a view calls
`loadOne`/`loadMany` through its OWN handle while its own tracked evaluation is
open — the fault path calls un-warned internal loaders, and a call on the raw
store (a click handler, a timer) is nobody's tracked read and stays silent.

## Invariants

- **Core owns no server verbs.** An app that never passes the capability has no
  `loadMany`, no `upsert`, no `save()`/`delete()`, no write chain, no settle
  loop, and no adapter error class — and never links this module at all.
- **The dependency points one way.** This module imports core; core never
  imports it, and holds the capability as an opaque value it does not interpret.
- **The bound adapter view is memoized on first use.** A model that rewrites its
  `static adapter` after the first `adapter(type)` call keeps the original
  bindings for that Store.
- **One network seam.** Every generated transport, every author function using
  the fetch it was handed, and `request()` funnel through the same hook and the
  same network call. That single seam is what dev and test tooling replaces.
- **The hook may not move method or body.** A replacement init returned by the
  hook is shallow-copied before method and body are re-stamped, so a frozen or
  getter-only object is a supported shape rather than a `TypeError`.
- **A body is read exactly once**, preferring JSON and preserving non-JSON text;
  an empty body reads as absent.
- **Per-record write-chain state and the D161 read state live in module-level
  `WeakMap`s keyed by Store**, so two stores never share a queue or a cache and
  a discarded store's state is collectable.
- **Every in-flight read entry clears in `finally` with an identity check, and
  every started fault promise carries a rejection observer** — a data pass that
  throws or is superseded can never leave an unhandled rejection or a stuck
  in-flight key.
- **Removing a record records it absent, and the absence is newer than every
  read already in flight.** `record.destroy()` and a confirmed `record.delete()`
  both go through `removeRecord`, which marks the identity absent and stamps the
  entry one step ahead of the read-dispatch counter. A load or create that comes
  after clears it; a response for that identity from a read dispatched before it
  is dropped in `_upsert` before any side effect, and a record created there
  inherits the stamp so the older response cannot merge into it either.
- **A `loadOne` response must be the record asked for, but only on the
  automatic fault path**: there, a pk that differs from the requested id under
  `recordKey` normalization rejects before mutation, so an implicit fault can
  never miss forever. Explicit `store.loadOne` is permissive — it accepts
  whatever record the server returns and clears the requested id's negative
  entry on success.

## Gotchas

- `store.upsert()` is not a core Store method. Nor are `save()` and `delete()`
  core record methods — only `destroy()`, the local-only removal, is. Without the
  capability those names simply do not exist, and calling one is a plain "not a
  function".
- Adapter-config validation allow-lists a `mock` key it never reads. That key
  belongs to [[COMPONENT-FIXTURES]], and allowing it here is what lets a model
  carry its mock block checked in beside its endpoint without a warning.
- [[COMPONENT-FIXTURES]] imports this module and installs the capability itself
  before replacing the network seam, so a fixtures-only test still gets the full
  server surface even when the app never passed the capability.
- `request()` resolves its URL from the model's `endpoint` and therefore still
  requires one, even for a model whose five verbs are all author functions.
- The generated transports are the only thing tied to REST. Nothing above them
  is: an app can replace every verb and keep validation, identity, ordering,
  reconciliation, and notification exactly as they are.
- LOADED and EXHAUSTIVE are two different facts and only one of them is about
  the framework's own request. A successful no-options collection load —
  implicit fault or explicit `loadMany(type)` with no argument (`null` counts as
  no-options; `{}` does not) — marks the type loaded, which is what stops a
  tracked `findMany` re-requesting it every settle pass. It marks the type
  exhaustive, letting a `findOne` miss answer `null` with no detail request,
  ONLY when the endpoint-generated REST transport made the request. A `loadMany`
  authored on the model or supplied by an `adapter.defaults()` dialect is opaque
  — page one is a legitimate response — so its loads never mark exhaustive, and
  an off-page id is still fetched. `loadOne`, `createRecord`, `upsert`, `save`,
  hydration, and options-bearing loads mark neither. An empty-array success from
  the generated transport DOES mark both.
- A prerender read must be answerable from the build machine: an absolute
  `apiURL` is fetched for real, a model with no `endpoint` and no read verb
  never faults (seed the store in `beforeMount`), and an app-relative URL fails
  the build with a diagnostic — there is no build-time server standing in for
  one.
