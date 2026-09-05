---
name: D146 — transactional reused-ancestor refresh (prepare/commit)
status: verified
connections:
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D39-SKELETON
  - DECISION-D145-ERROR-BOUNDARIES
  - FEATURE-TRANSACTIONAL-ANCESTOR-REFRESH
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: gotcha
    text: >-
      prepareRefresh's #evalScope save/restore assumed one invocation per prepare, but withTracking
      retries a .then-style (sync-shaped async) run behind an in-flight chain — and the retry
      started while the ABANDONED first invocation's scope was still installed, captured it as its
      unwind target, and restored it at the end. A discarded navigation could then leave the
      destination scope live (view.params read the destination after discard()), and the abandoned
      invocation's late restore could clobber the retry mid-run. Fixed (Codex review round): the
      unwind target is captured once per prepare, each invocation installs its own scope copy, and
      async tails restore only while they still own #evalScope. Commit/discard semantics unchanged.
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/PuzzleView.js
  - client-runtime/router/router.js
  - client-runtime/datastore/store.js
  - client-runtime/datastore/adapter.js
  - client-runtime/views/viewManager.js
  - client-runtime/devtools.js
---

# D146 — transactional reused-ancestor refresh (prepare/commit)

Reused ancestors join the atomic commit block. A gated navigation either lands
completely — URL, history, title, mounted tree, scroll save, **and** every
reused ancestor's params, route snapshot, data, and store subscriptions — or
changes nothing at all. This extends [[DECISION-D61-ATOMIC-LOCATION-COMMIT]]'s
window to the last piece of state that sat outside it.

## Two phases

`PuzzleView.prepareRefresh({ params, props, route })` (router-internal; no
public type surface) runs `data()` against the DESTINATION params and route,
captures the model result and the store subscriptions the run tracked, renders
nothing, and mutates no committed field. It returns
`{ ready, commit(), discard() }`, or null where `refresh()` also no-ops
(destroyed, leaving, or profiler-blocked view).

The router pushes `ready` into the gated `loads` array at the position the old
inline refresh occupied, so store tracking serialization is unchanged.
`#commitState` then calls `commit()` on each prepared ancestor — synchronously,
after `#state` is assigned, inside the same `#committing` window as
`#commitLocation` and the mount. Every exit that does not reach a commit calls
`discard()`: the gate's catch, both token-supersession checks, the SSG-takeover
supersession branch, and `#abandon`.

`commit()` swaps params/props/route, applies the held subscription reconcile,
bumps `#runToken`, and re-renders from the already-computed model — `data()`
never runs twice on the ordinary path. `discard()` drops only the
subscriptions that run added. A discard is invisible to the app: no render, no
lifecycle hook, no error-view replacement, no `onStoreChange` (D145's
`phase: 'navigation'` report stays the single signal for a failed navigation).

**Commit-conflict convergence.** `prepareRefresh` captures `#runToken` at
prepare. A commit that finds the token moved knows a store-change refresh
committed while the gate was open — the prepared model predates that edit, so
committing it would display pre-edit data until an unrelated later write. The
commit still lands params/route/subscriptions, then bumps the token and
converges through `refresh()` instead of committing the stale model. The
conflict path costs one extra `data()` run and one tick of the pre-edit value;
the non-conflicting path keeps the single-render, no-re-run guarantee.

**Exception safety.** Handles are idempotent (a `settled` flag), and
`#navigate` wraps the load phase and the awaited `#swap` in a `finally` that
discards every prepared handle unconditionally. Explicit discards on the bail
paths remain, but no exit — including a user `render()`/`afterUpdate()` throw
inside the synchronous commit block — can reach neither commit nor discard and
strand holds in `Store._heldKeys`.

## Subscription holding


A prepared run never weakens the live subscription set. Last-good keys stay
subscribed AND the prepared run's keys go live, so the view is transiently
over-subscribed (an extra notify at worst) and a discard can never strand a
mounted view. `Store.withTracking` takes a fourth held-eval channel: a
successful prepared eval parks its reconcile instead of applying it, and the
caller's commit/discard decides direction (commit drops `before \ added`,
discard drops `added \ before` — both subject to the holds below). Scope
restore of `_tracking`/`_trackingAdded` is never deferred — that is stack
discipline. A failing eval reconciles immediately, exactly as before.

**The decision can precede the lease.** The pending object `prepareRefresh`
allocates is decision-bearing, not a mailbox for a callback: commit and
discard record their verdict on it whether or not the evaluation has finished.
An ASYNC prepared `data()` publishes its held reconcile late — by then the
router may already have discarded the handle on a superseded or failed
navigation — so the publishing side reads the recorded verdict and applies it
in the same turn: a handle already discarded releases its holds immediately,
and one already committed adopts them immediately. Nothing is parked waiting
for a reconcile callback that will never be installed, so a decision taken
before the run finishes can never leave a mounted view's keys leased to a run
nobody owns.

`Store._heldKeys` (subscriber → `Map<key, {count, adopted}>`) fences prepared
keys from every other eval's garbage collection. Holds are **refcounted over
every key the eval queried** — not just its net-new ones — because overlapping
prepares must compose: a second prepare's `before` already contains the first
prepare's live additions, so a net-new-only hold would leave it holding
nothing, and the first prepare's discard could unsubscribe the very key the
winner is about to commit. Both reconcile branches skip any key whose
remaining count is nonzero, and an outcome releases exactly the holds its own
eval took. A committing prepare additionally marks its keys `adopted` while
other holds remain open: a superseded prepare's later discard treats an
adopted key as committed state, not as its own reversible addition — covering
the ordering where the loser's decrement would otherwise zero the count right
past the winner's claim. Without any of this a mid-gate store-change refresh —
which correctly runs with the OLD params while the ancestor still shows the
old route — would see the prepared keys in its pre-eval set, not re-query
them, and drop the prepare's subscriptions; the ancestor would commit
subscribed to nothing for the new route and silently stop reacting.
`unsubscribe()` clears held state, so a destroy between prepare and commit
reconciles over an empty set.

The DevTools bridge reports the hold: `snapshot:subscriptions` returns a third
`held` map alongside `byKey`/`byView` (additive — a panel predating it renders
unchanged). Held keys are real subscriptions and still appear in the other two,
but splitting them out keeps an open navigation from reading as a leak in the
Subscriptions panel.

## Ordering and visibility

- **Token ordering.** Prepare deliberately does not touch `#runToken`. While
  the gate is open the ancestor legitimately shows the old route, so a
  store-change refresh runs and renders normally with old params; the commit's
  bump supersedes any still in flight, whose params are stale by definition.
- **`this.route` during prepare.** A `#evalScope` field (save/restore stack
  discipline, mirroring `Store._tracking`) makes the `params`/`route` getters
  return destination values inside a prepared evaluation while `#route` and
  `#params` stay committed — [[DECISION-D47-ROUTE-SNAPSHOT]]'s invariant intact
  with nothing to roll back on failure. Everything that re-enters the instance
  from the event loop is fenced through `#withCommittedScope(fn)`
  (save/null/run/restore): renders (`#renderNow`), DOM event handler dispatch
  (the view manager threads the owning view into `setAttr` and wraps each
  patch-managed listener), `flushUpdates`/`setData`, `refresh()`/
  `onStoreChange()`, and the `mounted`/`destroyed` hooks — so app code running
  mid-gate reads the committed route, while `data()` itself still sees the
  destination.
- **Skeletons.** The [[DECISION-D39-SKELETON]] leaf path commits through
  `#commitState` like every other path, so prepared ancestors land in the
  immediate (un-awaited-leaf) commit where the old inline refresh did.
- **Layout chrome.** D47's `reuseLayout` ordering is unchanged: ancestors
  commit inside `#commitState` after `#state`, so the layout chrome refresh
  still runs last and now also sees ancestors already naming this route.

## Known residual


`#evalScope` persists across a prepared ASYNC `data()`'s awaits. Every
runtime-controlled reentry is fenced (see Ordering above), but a closure app
code itself schedules from inside the gate — a `setTimeout`, a
`fetch().then`, a captured `this` — runs outside any fence and reads the
destination scope. There is no browser primitive for async-local scope, so
this window is documented rather than closed.

A second shape is a real divergence, not a theoretical one. Slot-forwarded
content is patched by the ENCLOSING view's manager, so a handler AUTHORED in
one view but rendered into another view's tree is fenced against the
RECEIVING manager's owner: `#withCommittedScope` nulls the receiver's scope —
already null — while the author's prepared scope stays installed for the whole
gate. During a pending params-only navigation such a handler therefore reads
the DESTINATION route from `this.params`/`this.route` while nothing has
committed and the screen still shows the old route. It reproduces with a plain
default slot; snippets are not required, and the shape is not confined to
them. **App-side mitigation:** a handler forwarded through composition should
take its ids from the rendered model or from its props, which describe what is
on screen, rather than from `this.params`. The runtime fix — carrying the
authoring view on the forwarded vnode at slot-partition time so the listener
installer fences the AUTHOR — is planned for 0.7.1 and is not shipped.

## Alternatives rejected

- **Rollback after failure** (re-run `data()` with old params in the catch):
  re-entrant, double-renders, side-effecting `data()` runs twice, and a second
  failure has no floor.
- **Snapshot/restore of rendered state**: misses store subscriptions and
  `#route`; fragile.
- **Bumping `#runToken` at prepare**: would suppress the mid-gate store-change
  refreshes that are correct while the old route is still displayed.
- **Committing the prepared model unconditionally**: a store-change refresh
  that committed mid-gate would be clobbered by the older prepared model,
  displaying pre-edit data until an unrelated later write — hence the
  token-checked convergence rule.
- **Threading the destination scope as an explicit `data()` argument**
  (`data(params, props, { route })` with no getter override): closes the
  app-scheduled-closure residual completely, but breaks the documented D47
  `data()` contract and every app's signature for a window that fencing the
  runtime's own reentry points already reduces to self-scheduled closures.
- **Leaving the divergence in place**: the wrong organization's chrome rendered
  under the right URL is user-visible and silent — no throw, no log.
