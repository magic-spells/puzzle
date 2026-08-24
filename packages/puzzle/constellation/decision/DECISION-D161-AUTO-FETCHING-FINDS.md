---
name: D161 — Tracked finds fault in missing data; the settle loop commits complete passes (v1.76)
status: verified
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
  - kind: verified
    text: >-
      Post-merge claim-level verification: every Decision claim traced to code and tests (both
      suites green — 1712 vitest, full go test; settle-loop + auto-fetching suites 44/44).
      Fixture-eligibility wording corrected in place: installFixtures() installs the capability
      itself, so fixture apps fault through the mock at the _network seam rather than being
      untouched.
    sha: 516f7d62ef156359eab7170d68103dc78e6bbb8f
  - kind: state
    text: >-
      Post-merge hardening (Codex review round): (1) _faultOne now enforces the card's
      collection-complete ⇒ pure-local rule — it previously checked only nullish id / negative cache
      / in-flight / verb, so a missing id on a complete type still queued a detail GET. (2) The "per
      evaluation, never Store-global" request-map rule survives .then-style data(): a plain function
      returning a Promise runs once inline before the store can know its shape, and that abandoned
      first invocation's post-await finds recorded into whichever eval held _requests. Mitigated
      with a sticky per-view `_dataAsyncShape` flag (underscore-public — the settle loop installed
      by the adapter capability ORs it into its per-pass expectsAsync hint) plus a dev-only
      warn-once steering to `async data()`.
  - kind: deviation
    text: >-
      KNOWN GAP against this card's "Reads outside data() never fetch" claim — the code does NOT
      honor it yet. `_requests` stays installed for the whole lifetime of an async `data()`, across
      every await, so an untracked query running while a view is suspended (event handler, timer,
      model method) issues a real request AND lands in that suspended evaluation's request map — an
      unrelated 500 can reject a view that never queried that type. Unfixable store-side: an eval's
      post-await segments are structurally indistinguishable from foreign code (no withTracking
      frame, call depth 0, later task), and simply dropping post-await faulting would commit empty
      for `async data(){ await x; return {posts: findMany('post')} }`, making committed-empty mean
      "still loading" — the exact ambiguity this card exists to prevent. The fix belongs at the
      runtime's reentry points (PuzzleView.#withCommittedScope + the __withCommittedScope bridge)
      and needs "restore only while you still own it" discipline, NOT a naive save/restore — a naive
      fence clobbers an inner async eval's map when a handler calls refresh(). Shipped in 0.7.0
      as-is; deliberate, tracked, own branch.
verified_at: '2026-08-23T19:12:34.759Z'
verified_sha: 516f7d62ef156359eab7170d68103dc78e6bbb8f
---

# D161 — Tracked finds fault in missing data; the settle loop commits complete passes (v1.76)

`store.findOne`/`store.findMany` fetch what's missing — but only during a
tracked `data()` evaluation, and the view commits only a pass that queued no
fetches. Views need zero loading code; `null` in committed data means
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

1. Run a pass with its own pending-request set. A tracked read that isn't
   already satisfied — a `findOne` miss, or a `findMany` on a type not yet
   collection-complete — returns its local value (`null`/locals) and queues a
   deduped fetch when the model has a resolvable read verb.
2. Pending set non-empty ⇒ do not commit; await the batch, discard the
   intermediate pass's subscriptions, re-run.
3. Commit the first pass that queues nothing; only that pass's subscriptions
   become committed state. Dependent reads (post → `post.authorId` → author)
   settle across rounds — waterfalls need no declared dependency graph.
4. Ten-round cap **throws** through the normal data-failure path (view name +
   last round's request keys). Never warn-and-commit: a partial commit would
   make `null` ambiguous again.

**Fetch eligibility.** A tracked miss faults only when the MODEL ITSELF
declares server intent: its own `static adapter` names the read verb as a
function, or it declares an `endpoint`. `findOne` needs `loadOne`, `findMany`
needs `loadMany`. An app-wide `adapter.defaults()` supplies the *dialect* for a
model that already qualifies — it does not by itself make a model
server-backed, or every local-only model in a dialect app would fault to
`GET undefined`. Only the AUTOMATIC path is gated this way: an explicit
`store.loadOne`/`loadMany` still dispatches through the app-wide dialect
exactly as D158 specifies, and the write verbs are untouched. No adapter
capability, no resolvable verb, nullish id, negative-cached id, or
collection-complete type ⇒ pure local, exactly the prior behavior —
local-first apps (no capability, or models with no endpoint and no authored
read verb) are untouched. A fixtures app faults like a server app:
`installFixtures()` installs the capability itself, and the mock serves the
faults at the `_network` seam.

**Reads outside `data()` never fetch.** Event handlers and model methods get
local snapshots; server-backed rendering belongs in `data()` (handlers use
`refresh()`). An untracked fetch would have no guaranteed consumer.

**Relationships never fault.** `belongsTo`/`hasMany` getters resolve through
private local-only lookups that record the same subscription keys (D49
amended) — `post.author` in a 50-row list must not become 50 GETs.

**Read state is adapter-owned** (WeakMap keyed by Store, in the `/adapter`
module — the D157 no-adapter bundle carries none of it): in-flight dedup (by
`recordKey` identity for single records, by type for collection loads), a
never-persisted 1000-entry negative LRU, and a collection-complete type set.
Only a framework-normalized 404
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
generated REST would quietly hit different URLs. `loadOne`/`loadMany` are
demoted from the taught default to escape hatches (dev-mode warning when
called inside a tracked run).

**Prerender fetches at build time** through the same loop; a non-404 fault
failure fails the build naming the route (a 404 settles as absence, exactly
as at runtime). Static output transfers read state (collection-complete
types + negative identities) in a versioned data-island envelope so
`mountStatic` doesn't refetch what the build settled; hybrid deliberately
transfers nothing — its SPA takeover re-runs `data()` as a fresh session.
HMR snapshots carry read state but never in-flight promises. Prerender runs
in Node, which has no page origin, so `prerenderToDir` serves the staged
output on an ephemeral loopback origin and resolves app-relative reads
against the build output it is writing; an endpoint it cannot resolve fails
the build with a diagnostic naming the endpoint and both remedies.

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
