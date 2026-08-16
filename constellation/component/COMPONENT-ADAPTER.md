---
name: Server adapter runtime (@magic-spells/puzzle/adapter)
status: built
connections:
  - FILE-ADAPTER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-PUZZLE-APP
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
  - FEATURE-ADAPTER-WRITE-SYNC
  - FEATURE-STORE-PUBLIC-UPSERT
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

Installing copies two method bags onto the core prototypes as ordinary property
descriptors.

- [[COMPONENT-STORE]] gains `adapter(type)`, `loadAll`, `loadOne`, `upsert`,
  `saveRecord`, `deleteRecord`, `request`, and the private helpers behind them —
  including the `beforeRequest` hook seam and the single network seam beneath it.
- [[COMPONENT-PUZZLE-MODEL]] gains `save()` and `delete()`.

Install is idempotent and realm-global: the first call wins, later ones are
no-ops, and several apps on one page share one installed surface.
[[COMPONENT-PUZZLE-APP]] rejects a truthy `adapter` that is not a capability at
construction time, installs before constructing the Store, and warns in
development when a model declares `static adapter` while no capability was
passed. `@magic-spells/puzzle/static` and the testing helpers validate-and-install
through the same shared check, so a static page or a bare `mountView` gets the
identical surface.

What is *per Store* is the dialect, not the install: the capability object the
app passed is retained on the Store, and verb dispatch reads its app-default
functions from there.

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
parsed-or-raw `body`.

Development builds validate two shapes and warn rather than throw: a model's
adapter keys must be `endpoint`, `mock`, or functions (warned once per model
class), and `adapter.defaults()` keys must be the five verb names with function
values. Both checks are folded out of production.

## Invariants

- **Core owns no server verbs.** An app that never passes the capability has no
  `loadAll`, no `upsert`, no `save()`/`delete()`, no write chain, and no adapter
  error class — and never links this module at all.
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
- **Per-record write-chain state lives in module-level `WeakMap`s keyed by
  Store**, so two stores never share a queue and a discarded store's chains are
  collectable.

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
