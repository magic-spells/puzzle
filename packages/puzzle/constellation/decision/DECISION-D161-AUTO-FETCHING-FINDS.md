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
      static kernel. The core seam costs a no-adapter app +177 B gzip for the fault hooks and
      _settleData call sites, plus +50 B for the identity-attribution seam — that second figure is
      small only because the tracked read pair, the handle Proxy and _deriveCtx all live
      adapter-side; core keeps just the HANDLE_CTX slot in withTracking/unsubscribe, one optional
      _deriveCtx call in the constructor, and the prototype-chain lookup in errors.js. Verify both
      directions by grepping the built bundles: a no-adapter app has no MAX_SETTLE / "settle rounds"
      / _findOneTracked / _handleFor and only the _deriveCtx call site; an adapter app has all of
      them.
  - kind: gotcha
    text: >-
      unsubscribe() is NOT only a teardown signal — playOut() calls it on a LIVE view that
      _restoreFromLeaving() can put back on screen and refresh. So nothing that unsubscribe() does
      to the handle may be a sticky latch: it clears hctx.requests, and withTracking's restore
      consults the subscriber's live isDestroyed instead. A `dead` flag set there looked right and
      shipped briefly; it stranded a restored view's request map on the next nested evaluation's
      exit, so the view silently stopped fetching. Regression:
      tests/tracked-read-attribution.test.js 'a view that left and came back is fully re-armed'.
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
      evaluation" request-map rule survives .then-style data(): a plain function returning a Promise
      runs once inline before the store can know its shape, and that abandoned first invocation's
      post-await finds record into whichever evaluation is open when they resume. Mitigated with a
      sticky per-view `_dataAsyncShape` flag (underscore-public — the settle loop installed by the
      adapter capability ORs it into its per-pass expectsAsync hint) plus a dev-only warn-once
      steering to `async data()`. Identity attribution later narrowed the blast radius of that
      residue to the view's own evaluations.
  - kind: decision
    text: >-
      Why identity-based attribution beat fencing the reentry points. The ambient `_requests` slot
      could not be made correct: an evaluation's post-await segments are indistinguishable from
      foreign code (no withTracking frame, call depth 0, later task), so the only choices were leak,
      or drop post-await faulting — which would commit empty for `async data(){ await x; return
      {posts: findMany('post')} }` and make committed-empty mean "still loading", the exact
      ambiguity this card exists to prevent. Fencing PuzzleView.#withCommittedScope /
      __withCommittedScope only covers callers that re-enter through Puzzle's own fences; timers,
      fetch().then continuations, third-party callbacks and every app.store consumer still leak, and
      the card's own text conceded that residue. Attributing by handle identity covers every foreign
      caller BY CONSTRUCTION, at the cost of one Proxy per view and the rule that a view reads
      through this.ctx.store. Two accommodations the design forced and that a future change must
      preserve: the handle's get trap binds every forwarded method to the RAW store (readStateFor's
      WeakMap key, _a, _asyncTrackingChain, _typeMap and the subscription Maps all break under a
      proxy `this`), and errors.js resolves its ctx-keyed CONFIG WeakMap through the prototype
      chain, because a view's ctx is now derived from the app's rather than being it.
  - kind: verified
    text: >-
      destroy() now records absence like delete(); identity guard narrowed to the automatic fault
      path; loopback build server removed, prerender rule is absolute apiURL | endpoint-less+seed |
      diagnostic — PRs #83/#84.
    sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
verified_at: '2026-08-24T05:28:09.597Z'
verified_sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
code_refs:
  - client-runtime/datastore/adapter.js
  - client-runtime/datastore/store.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/capabilities.js
  - client-runtime/devstate.js
  - client-runtime/ssg/index.js
  - client-runtime/static/index.js
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

**"Tracked" means read through the view's own store handle.** Faulting is
attributed by OBJECT IDENTITY, not by ambient state. The raw Store's
`findOne`/`findMany` are plain local reads with no fault branch at all; the
tracked pair `_findOneTracked`/`_findManyTracked` takes the open evaluation's
request map as a PARAMETER and is grafted on by the adapter module beside the
fault helpers, so a no-adapter bundle carries neither. The only caller is a
per-view HANDLE: a `Proxy` over the raw Store, minted in the PuzzleView
constructor, forwarding everything else to the raw Store with `this` bound to
it (every WeakMap key, `_a`, `_asyncTrackingChain` and Map in the module
depends on that identity). `_deriveCtx` — also adapter-side — wraps the handle
in the view's own `ctx`, `Object.create`d off the app's so `router`/
`formatters` stay live and always chained off the BASE ctx, keeping the chain
exactly two deep however deep the component nesting goes. Core's whole share is
one optional call in the constructor.

`withTracking` installs the evaluation's request map on the subscriber's handle
context — never on the Store, which has no ambient request slot at all — with
the same save/restore stack discipline `_tracking` uses. On the way out it
restores the enclosing map unless the subscriber is DESTROYED, which is read
live from `isDestroyed` rather than latched by `unsubscribe()`: `playOut()`
unsubscribes a view that `_restoreFromLeaving()` can put back on screen and
refresh, and that view owes every fault its `data()` still makes. An
adapter-free app mints nothing: `ctx.store` is the raw store, identity and all.

The consequence is the SPEC's sentence made literally true. Reads through the
raw `app.store`, through another view's handle, from a module capture, from a
record's `_store` inside a relationship getter, or from any code running while
some other view sits at an `await` — event handlers, timers, third-party
callbacks — are pure local snapshots. They cannot issue a request, and they
cannot drop a promise into a settle batch they do not own, so an unrelated 500
can no longer fail a view that never queried that type. Server-backed rendering
belongs in `data()`; handlers read local and call `refresh()`.

Two residues are documented, not defects. (1) The view's OWN deferred code
holding its OWN handle during its own suspension — a `setTimeout` inside
`data()` reading `this.ctx.store` — is attributed to that open evaluation and
does fault: same view, same data. (2) SUBSCRIPTION attribution stays ambient
(`_tracking`/`_trackingAdded`), because relationship getters resolve through
`record._store` and a record holds the raw Store — there is no identity to hang
a handle on, and traversal inside `data()` must keep auto-subscribing. A
foreign read during a suspension can therefore add one subscription key to the
suspended view, which that view's next evaluation reconciles away. Benign and
self-healing; it costs at most one extra notify.

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

**Relationships never fault.** `belongsTo`/`hasMany` getters resolve through
private local-only lookups that record the same subscription keys (D49
amended) — `post.author` in a 50-row list must not become 50 GETs.

**Read state is adapter-owned** (WeakMap keyed by Store, in the `/adapter`
module — the D157 no-adapter bundle carries none of it): in-flight dedup (by
`recordKey` identity for single records, by type for collection loads), a
never-persisted 1000-entry negative LRU, and a collection-complete type set.
Only a framework-normalized 404
(`PuzzleAdapterError`) records absence; network/5xx/401/403/shape errors
reject the run and poison nothing. Removing a record by any path — confirmed
`delete()` or local `destroy()` — records absence; the identity clears on any
load/create that returns it (create, upsert, load, hydration, save
reconcile/pk adoption). Explicit `loadOne` bypasses the negative cache as the
refresh escape hatch, and on success also clears the *requested* id's entry.
Only the AUTOMATIC fault path rejects a response whose pk differs from the
requested id before mutation — an implicit fault would otherwise miss
forever; explicit `store.loadOne` accepts what the server returns (a
slug-resolving endpoint, say). A type is collection-complete only after a
successful no-options collection load (empty-array success counts);
options-bearing loads stay partial. The read-state codecs unwrap a handle
before keying, so a caller holding `this.ctx.store` gets its store's real state
rather than a silently empty envelope.

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
in Node, which has no page origin: a prerender read must be answerable from
the build machine. An absolute `apiURL` is fetched for real; a model
declaring no `endpoint` and no read verb never faults, so its data comes from
seeding the store in `beforeMount({ store })`; an app-relative URL fails the
build with a diagnostic naming the URL and both remedies. The seam is the
global `fetch`, not `apiURL` — an authored D158 verb can hardcode a path that
never touches `apiURL` at all.

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
- **An ambient request slot on the Store** (the original shape) — the slot
  stays installed for the whole lifetime of an `async data()`, across every
  await, so every caller in the realm sees it: a foreign read fired a request
  the contract forbids and landed the promise in a suspended view's settle
  batch, where an unrelated 500 failed a view that never queried that type.
  Post-await segments of an evaluation are structurally indistinguishable from
  foreign code (no frame, call depth 0, later task), so no amount of care at
  the read site can tell them apart — the ambient design cannot be made
  correct.
- **Fencing the runtime's reentry points** (`PuzzleView.#withCommittedScope`
  and the `__withCommittedScope` bridge, with "restore only while you still own
  it" discipline) — covers only code that re-enters through Puzzle's own
  fences. Timers, `fetch().then` continuations, third-party callbacks and any
  consumer of `app.store` still leak, so the hole narrows rather than closes.
  Identity-based attribution covers every foreign caller by construction, and
  its residue is same-view code only.
- **Passing the store into the hook** (`data(params, props, { store })`) — a
  public signature change for every view and example, and `this.ctx.store`
  would remain a live trap beside it.

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
