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
    action: >-
      re-enter through push() when the denied navigation was a push, replace() for a pop or
      navigation zero; this attempt ends here
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
    guard: a lazy() loader, a view/layout constructor, or a gated load rejected
    action: >-
      report phase 'navigation', drop or destroy the fresh views and layout, discard every prepared
      ancestor handle, restore a stalled leaver, repair a popped URL, stay put
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
---

# Navigation state machine

One navigation attempt, request to commit. The machine is the same in every router mode
(path, hash, memory) — a mode owns only three seams (read URL, write URL, link
interception), never the phase order. The step-by-step pipeline is
[[FLOW-NAVIGATION]]; the per-instance machine LOAD and COMMIT drive is
[[STATE-VIEW-LIFECYCLE]]; implementation is [[COMPONENT-ROUTER]].

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
  loading --> failed: lazy / constructor / gated load rejected
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

## The token is a navigation's identity

A monotonic token is claimed after the match, never before — bumping on an unmatched path
would doom a legitimate in-flight navigation, leaving its outgoing view played out over a
router state that still claims it. Every await is followed by a token re-check; stale
results are discarded. Last navigation wins, and the loser cleans up only what it built.

## The commit is atomic

`committing` is one synchronous block: URL and history entry (or memory stack), `document.title`,
the outgoing scroll save, the mounted tree, committed router state, every prepared
reused-ancestor refresh (params, snapshot, model, subscriptions), the scroll landing, then
focus and announcement. Rejected alternatives: committing the URL when loads resolve and
then animating (phantom history entries for superseded navigations, URLs naming views that
never mounted), and rollback (racier than never committing).

## Terminal outcomes are different on purpose

- **unmatched** — nothing happened; no token, so an in-flight navigation is untouched.
- **blocked** — a guard refused; nothing was constructed. A blocked pop repairs the address
  bar (the browser moved it before the guard ran).
- **redirected** — control passed to another navigation with the same verb class; awaiting
  the denied navigation observes the redirect's commit.
- **failed** — a pre-commit failure: fresh instances dropped/destroyed, prepared ancestors
  discarded, stalled leaver restored, error reported, and a popped URL repaired with
  `replaceState` so the address bar matches the DOM. This navigation owns the token, so it
  owns cleanup.
- **superseded** — a newer navigation owns the token. The loser must NOT touch shared state:
  it abandons its fresh instances and leaves the outgoing unit for the winner (tearing it
  down would rip it out from under a mid-flight morph).

## Gotchas

- A pop is asymmetric: the browser already moved the URL, so commit contributes only title
  (and memory index); every non-committing exit on a pop must restore the committed URL.
- `entering` isn't awaited — the machine is effectively idle when the commit window closes,
  which is why a `mounted()` hook's push is parked in one last-wins slot and re-dispatched
  afterwards.
- A skeleton view opts out of the LOAD gate, not the machine: its failure lands after
  commit, so the URL names a page showing its loading state. On prerender takeover at
  navigation zero the exemption is suppressed.
- Post-commit failures (render, `mounted()`) never re-enter this machine; they belong to
  [[STATE-VIEW-LIFECYCLE]] — the commit stands and only the failed position is replaced.
