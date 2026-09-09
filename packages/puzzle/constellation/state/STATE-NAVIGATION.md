---
name: Navigation state machine
status: verified
states:
  - name: idle
    initial: true
  - name: matching
  - name: guarding
  - name: loading
  - name: leaving
  - name: committing
  - name: entering
  - name: unmatched
    terminal: true
  - name: blocked
    terminal: true
  - name: redirected
    terminal: true
  - name: failed
    terminal: true
  - name: superseded
    terminal: true
transitions:
  - from: idle
    to: matching
    guard: >-
      not a same-path no-op, not a duplicate of the in-flight target, and not inside the commit
      window
    action: a request from push(), replace(), an intercepted link click, popstate/go(), or navigation zero
  - from: matching
    to: unmatched
    guard: no leaf matcher hit and no top-level catch-all is declared
    action: warn and stay; the token is deliberately NOT bumped, so an in-flight navigation survives
  - from: matching
    to: guarding
    guard: matched and the chain declares at least one inherited guard
    action: claim the token, freeze the route snapshot, capture the departure scroll position
  - from: matching
    to: loading
    guard: matched with an empty guard chain
    action: stay on the synchronous path through to view construction — no await, no microtask
  - from: guarding
    to: loading
    guard: every guard returned undefined or true
  - from: guarding
    to: blocked
    guard: a guard returned false, or threw
    action: >-
      restore a stalled leaver; a blocked popstate rewrites the address bar back to the committed
      route
  - from: guarding
    to: redirected
    guard: a guard returned a path string and fewer than ten redirects have run without a commit
    action: re-enter through the public replace() seam; this attempt ends here
  - from: guarding
    to: superseded
    guard: the token moved across an awaited guard
    action: return silently — no fresh instance exists to tear down
  - from: loading
    to: committing
    guard: >-
      keep equals the chain length — a params-only or query-only navigation, no fresh instance and
      no animation
  - from: loading
    to: leaving
    guard: every gated load resolved and this navigation still owns the token
  - from: loading
    to: failed
    guard: a gated load rejected
    action: >-
      report phase 'navigation', destroy the fresh views and layout, discard every prepared ancestor
      handle, restore a stalled leaver, stay put
  - from: loading
    to: superseded
    guard: the token moved while the gate was awaited
    action: destroy the fresh views and layout, discard every prepared ancestor handle, return
  - from: leaving
    to: committing
    guard: >-
      sequential: the out animation and any morph-leave settled and both token re-checks passed;
      overlap: the out is never awaited
  - from: leaving
    to: superseded
    guard: the token moved during the out animation or the morph fly-back
    action: >-
      abandon the fresh chain and leave the outgoing unit standing for the winning navigation to
      destroy
  - from: committing
    to: entering
    action: >-
      one synchronous window moved location, title, history or memory stack, the outgoing scroll
      save, the mounted tree, router state, the prepared ancestors, the scroll landing, and focus
      plus announcement
  - from: entering
    to: idle
    guard: the enter animation is fire-and-forget — idle is reached without awaiting it
    action: run any push a mounted() hook deferred during the commit window
connections:
  - FLOW-NAVIGATION
  - STATE-VIEW-LIFECYCLE
  - COMPONENT-ROUTER
  - FILE-ROUTER
  - DOC-SPEC-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DOC-ROUTER
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D56-OVERLAP-TRANSITIONS
  - DECISION-D28-ANIMATIONS
  - DECISION-D39-SKELETON
  - DECISION-D83-QUERY-REPLACE
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
  - DECISION-D159-ROUTER-MODE-FACTORIES
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Navigation state machine

One navigation attempt, from request to commit. The machine is the same in
every router mode — path routing (the inline zero-config default), hash, and
memory — because the mode only owns three seams (reading the URL, writing it,
and the link interceptor), never the phase order. The step-by-step pipeline,
including what each phase actually does, is [[FLOW-NAVIGATION]]; the per-instance
machine the LOAD and COMMIT phases drive is [[STATE-VIEW-LIFECYCLE]].

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> matching: push / replace / link click / popstate / go / navigation zero
  matching --> unmatched: no match, no catch-all
  matching --> guarding: matched, chain declares guards
  matching --> loading: matched, no guards
  guarding --> loading: every guard allows
  guarding --> blocked: false or throw
  guarding --> redirected: path string
  guarding --> superseded: newer token
  loading --> committing: params-only (keep == chain length)
  loading --> leaving: gate resolved
  loading --> failed: a gated load rejected
  loading --> superseded: newer token
  leaving --> committing: out settled, token re-checks pass
  leaving --> superseded: newer token mid-out or mid-flyback
  committing --> entering: atomic window closed
  entering --> idle: enter is fire-and-forget
  unmatched --> [*]
  blocked --> [*]
  redirected --> [*]
  failed --> [*]
  superseded --> [*]
```

## The token is the identity of a navigation

A monotonic token is claimed the moment a navigation becomes real — after the
match, never before. That ordering is load-bearing: bumping on an unmatched
path would doom a navigation that is legitimately mid-flight, leaving its
outgoing view fully played out (held invisible by the out animation's fill)
over a router state that still claims it.

Every await in the machine is followed by a token re-check. A resolved value
belonging to a stale token is discarded, not applied. Last navigation wins, and
the loser's obligation is precisely to clean up what it built and leave what it
did not.

## The commit is atomic because a partial commit has no correct repair

`committing` is one synchronous block with no await inside it. It moves
together:

- the URL and history entry (or, in a urlless mode, the entry stack and index)
- `document.title`, resolved nearest-defined leaf to root
- the outgoing entry's scroll position, saved under its own key
- the mounted DOM tree
- the router's committed state — path, query, params, chain, instances, keys
- every prepared reused-ancestor refresh: params, route snapshot, model, and
  store subscriptions
- the incoming scroll landing, then focus and the route announcement

The alternative — commit the URL when loads resolve, then animate — was what
shipped originally and it left two holes: a phantom history entry for a
navigation superseded during the out animation, and a URL naming a view that
never mounted. Rollback was rejected as racier than never committing in the
first place, which is why the whole set waits for the last token check rather
than unwinding after one.

## The terminal outcomes are genuinely different

Collapsing them loses information the router needs.

- **unmatched** — nothing happened at all. No token, so an in-flight
  navigation is untouched.
- **blocked** — a guard refused. Nothing was constructed, so there is nothing
  to destroy; a blocked popstate additionally repairs the address bar, because
  the browser had already moved it before the guard ran.
- **redirected** — this attempt ended by handing control to another
  navigation. Awaiting the denied navigation observes the redirect's commit.
- **failed** — a gated `data()` rejected. Fresh instances are destroyed,
  prepared ancestors discarded, a stalled leaver restored, and the failure is
  reported through the error funnel. This navigation still owns the token, so
  it owns the cleanup.
- **superseded** — a newer navigation owns the token. The loser must NOT clean
  up shared state: it abandons its own fresh instances and leaves the outgoing
  unit standing, because the winner destroys it through its own out-phase
  skip. A loser that tore down the leaver would rip it out from under a
  mid-flight morph.

## Gotchas

- A pop is asymmetric by design: the browser already moved the URL, so the
  commit contributes title (and memory index) only, and a *failed* pop can
  leave the address bar ahead of the rendered view. There is no history
  rollback.
- `entering` is not a phase the router waits on. The enter animation is
  fire-and-forget, so the machine is effectively idle the instant the commit
  window closes — which is why a `mounted()` hook that pushes is deferred to a
  single last-wins slot and re-dispatched through the public verb afterwards,
  rather than re-entering against stale state.
- A view that declares a skeleton opts out of the LOAD gate, not out of the
  machine. Its failure lands *after* `committing`, so the URL names a page
  showing its declared loading state. On a prerender takeover at navigation
  zero the exemption is suppressed, or the mount would draw a skeleton over
  real content.
- Post-commit failures never re-enter this machine. A render or `mounted()`
  throw belongs to [[STATE-VIEW-LIFECYCLE]]: the commit stands, and only the
  failed position is replaced.
