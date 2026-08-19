---
name: D161 — Tracked finds fault in missing data; the settle loop commits complete passes (v1.76)
status: building
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
notes:
  - kind: gotcha
    text: >-
      router.stop() bumps its token but never destroys a view still in preload(), so an abandoned
      pre-commit view has no supersession signal and takes one more settle round (bounded by dedup,
      the caches, and the 10-round cap) before going quiet. Accepted for 0.7.0; a router-side
      destroy/abandon signal is the fix if it ever matters. Related fixture lesson: data() is
      contractually re-runnable — a test view with a one-shot gate in data() is a wrong fixture, not
      a framework bug.
  - kind: gotcha
    text: >-
      Bundle boundary mechanics: the settle loop is installed onto PuzzleView.prototype by
      installAdapter() (AdapterViewMethods), and static/index.js reaches the read-state codecs
      through a capabilities.js relay — never import datastore/adapter.js from core or from the
      static kernel. Cost of the core seam on a no-adapter app is +177 B gzip (fault-hook branches +
      _settleData call sites); the loop itself is provably absent (grep the built bundle for
      MAX_SETTLE / "settle rounds" — both 0).
---

# D161 — Tracked finds fault in missing data; the settle loop commits complete passes (v1.76)

`store.findOne`/`store.findMany` fetch what's missing — but only during a
tracked `data()` evaluation, and the view commits only a pass whose reads all
came up warm. Views need zero loading code; `null` in committed data means
"doesn't exist," never "still loading." Closes the gap D21 left open
(transparent query fault-in) and retires the eager-seeding idiom (mount-time
`loadMany` + the "never load inside `data()`" footgun rule).

## Context

Before this, `findOne`/`findMany` were pure local reads and the only shipped
real-server pattern was eager whole-collection seeding after `mount()`,
because a `loadOne` awaited inside `data()` loops: its own upsert notifies the
subscription the read just created, re-running `data()`, which fetches again.
Per-route on-demand fetching effectively did not exist. The design values are
firm: LOW learning curve, one obvious way, loading logic must not leak into
views, no `{#await}` templates, no separate `load()` hook.

## Decision

**The settle loop** (owned by PuzzleView, wrapped around every tracked
`data()` evaluation — refresh, routed preload, D146 prepareRefresh, component
mount, prerender):

1. Run a pass with its own pending-request set. A tracked miss returns its
   local value (`null`/locals) and queues a deduped fetch when the model has a
   resolvable read verb.
2. Pending set non-empty ⇒ do not commit; await the batch, discard the
   intermediate pass's subscriptions, re-run.
3. Commit the first pass that queues nothing; only that pass's subscriptions
   become committed state. Dependent reads (post → `post.authorId` → author)
   settle across rounds — waterfalls need no declared dependency graph.
4. Ten-round cap **throws** through the normal data-failure path (view name +
   last round's request keys). Never warn-and-commit: a partial commit would
   make `null` ambiguous again.

**Fetch eligibility.** A tracked miss faults only when D158 dispatch resolves
a read verb (model function → app default → endpoint-generated REST; an
endpoint is not required for authored verbs). `findOne` needs `loadOne`,
`findMany` needs `loadMany`. No adapter capability, no resolvable verb,
nullish id, negative-cached id, or collection-complete type ⇒ pure local,
exactly the prior behavior — fixture-driven apps are untouched.

**Reads outside `data()` never fetch.** Event handlers and model methods get
local snapshots; server-backed rendering belongs in `data()` (handlers use
`refresh()`). An untracked fetch would have no guaranteed consumer.

**Relationships never fault.** `belongsTo`/`hasMany` getters resolve through
private local-only lookups that record the same subscription keys (D49
amended) — `post.author` in a 50-row list must not become 50 GETs.

**Read state is adapter-owned** (WeakMap keyed by Store, in the `/adapter`
module — the D157 no-adapter bundle carries none of it): in-flight dedup by
`recordKey` identity, a never-persisted 1000-entry negative LRU, and a
collection-complete type set. Only a framework-normalized 404
(`PuzzleAdapterError`) records absence; network/5xx/401/403/shape errors
reject the run and poison nothing. Negatives clear when the identity arrives
by any path (create, upsert, load, hydration, save reconcile/pk adoption);
confirmed `delete()` records absence, local `destroy()` does not. Explicit
`loadOne` bypasses the negative cache — the force-refresh escape hatch. A
`loadOne` response whose pk differs from the requested id rejects before
mutation (otherwise an implicit fault misses forever). A type is
collection-complete only after a successful no-options collection load
(empty-array success counts); options-bearing loads stay partial.

**One/Many rename.** `store.loadAll` → `store.loadMany`, and the adapter verb
key everywhere (model `static adapter`, `adapter.defaults()`, bound adapter).
Every old spelling throws naming `loadMany` — including a registered model
carrying a `loadAll` key, caught at Store init, because silent fallback to
generated REST would quietly hit different URLs. `loadOne`/`loadMany` leave
the taught surface (dev-mode warning when called inside a tracked run).

**Prerender fetches at build time** through the same loop; failures fail the
build naming the route. Static output transfers read state (collection-
complete types + negative identities) in a versioned data-island envelope so
`mountStatic` doesn't refetch what the build settled; hybrid deliberately
transfers nothing — its SPA takeover re-runs `data()` as a fresh session.
HMR snapshots carry read state but never in-flight promises.

## Alternatives rejected

- **Async cache-first finds** (`await store.findOne(...)` in `data()`) — works,
  but puts an `await` and its un-awaited-Promise failure mode in every view;
  the settle loop keeps `data()` sync-looking, which is the learning-curve
  point.
- **Sync reads + reactive re-run without a settle gate** (miss returns null,
  view renders, upsert re-renders) — partial renders, null-guard glue in every
  template, `null` ambiguous between loading and missing, nothing for
  prerender to await.
- **`{#await}` template blocks** — moves loading states into template control
  flow; derived values (combine two records into one string) force loaded-yet
  conditionals into views. Progressive loading already exists as component
  granularity: a child component has its own `data()` and skeleton.
- **A separate `load()`/`model()` view hook** — two places to fetch, Ember's
  model()/beforeModel() split growing back.
- **Relationship auto-fetch** — N+1 storms from list views; the fix for a
  missing related record is one more tracked find in `data()`.
- **Fetch from untracked reads (event handlers)** — silent work with no
  guaranteed subscriber.
- **Warn-and-commit at the round cap** — breaks the `null`-means-missing
  contract the whole design exists to provide.

## Consequences

Breaking (0.7.0): the rename + loud guards; tracked finds fetch on miss when
a read verb resolves; generated read failures normalize to
`PuzzleAdapterError`; the static data-island format gains the read-state
envelope. `data()` must tolerate multiple runs per navigation (already true
under store notifications; now guaranteed). Skeletons unchanged: all settle
rounds count as one D39 load with the D52 hold. Deferred, deliberately:
server-side query/pagination pass-through on `findMany` (fetch-all-once per
type is the policy until someone hits the wall — the signature has room),
TTL/`reload(type)` invalidation, request cancellation. D21 (read path), D158
(verb contract), and D49 (relationship traversal) are rewritten/amended in
place — this card owns only the new question: tracked fault-in, the settle
loop, dedup, and cache policy.
