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
      not a committed same-path no-op (resolves ok at once), not a duplicate of the in-flight target
      (joins its promise), and not inside the commit window (deferred)
    action: a request from push(), replace(), an intercepted link click, popstate/go(), or navigation zero
  - from: matching
    to: unmatched
    guard: no leaf matcher hit and no top-level catch-all is declared
    action: >-
      warn and resolve not-found; the token is deliberately NOT bumped, so an in-flight navigation
      survives
  - from: matching
    to: guarding
    guard: matched and the chain declares at least one inherited guard
    action: claim the token, freeze the route snapshot, capture the departure scroll position
  - from: matching
    to: loading
    guard: matched with an empty guard chain
    action: claim the token and stay synchronous through view construction — no await, no microtask
  - from: guarding
    to: loading
    guard: every guard returned undefined or true
    action: only now resolve lazy() markers, so a blocked or redirected route never downloads
  - from: guarding
    to: blocked
    guard: a guard returned false
    action: restore a stalled leaver; a blocked pop rewrites the address bar back to the committed route
  - from: guarding
    to: failed
    guard: a guard threw, or an eleventh redirect ran without a commit
    action: report phase 'navigation', restore a stalled leaver, repair a popped URL
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
      one synchronous window moves location, title, history or memory stack, the outgoing scroll
      save, the mounted tree, router state, the prepared ancestors, the scroll landing, and focus
      plus announcement
  - from: entering
    to: idle
    guard: the enter animation is fire-and-forget — idle is reached without awaiting it
    action: run the push or replace a mounted() hook deferred during the commit window
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
  - DECISION-D182-NAVIGATION-RESULT
verified_at: '2026-11-01T19:24:02.433Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Navigation state machine

One navigation attempt, request to commit, in `client-runtime/router/router.js`. The
machine is the same in every router mode (path, hash, memory): a mode owns only reading
the URL, writing it, and link interception. The step-by-step pipeline is
[[FLOW-NAVIGATION]]; the per-instance machine LOAD and COMMIT drive is
[[STATE-VIEW-LIFECYCLE]].

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> matching: push / replace / link click / popstate / go / navigation zero
  matching --> unmatched: no match, no catch-all
  matching --> guarding: matched, chain declares guards
  matching --> loading: matched, no guards
  guarding --> loading: every guard allows
  guarding --> blocked: false
  guarding --> failed: throw, or redirect cap
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

A monotonic token is claimed after the match, never before: bumping on an unmatched path
would doom a legitimate in-flight navigation. Every await is followed by a token re-check
and stale results are discarded. Last navigation wins; the loser cleans up only what it
built.

## The commit is atomic

`committing` is one synchronous block: URL and history entry (or memory stack),
`document.title`, the outgoing scroll save, the mounted tree, committed router state,
every prepared reused-ancestor refresh (params, snapshot, model, subscriptions), the
scroll landing, then focus and announcement. Rejected: committing the URL when loads
resolve and then animating (phantom history entries, URLs naming views that never
mounted), and rollback (racier than never committing).

## Terminal outcomes

`push()` and `replace()` resolve a never-rejecting `NavigationResult` (D182):
`{ ok: true, route, catchAll?, redirectedFrom? }` or
`{ ok: false, reason: 'blocked' | 'superseded' | 'not-found' | 'error', error? }`.

- **unmatched** → `not-found`. Nothing happened; no token, so an in-flight navigation is
  untouched.
- **blocked** → `blocked`. A guard returned `false`; nothing was constructed. A blocked pop
  repairs the address bar (the browser moved it before the guard ran). An entry guard that
  blocks navigation zero leaves the container empty and warns that it should redirect.
- **redirected** → the redirect's own result, plus `redirectedFrom`. The redirect inherits
  the denied verb (push mints its own entry; pop and navigation zero replace).
- **failed** → `error`. A guard throw, the redirect cap, or a pre-commit load failure:
  fresh instances dropped, prepared ancestors discarded, stalled leaver restored, error
  reported, a popped URL repaired with `replaceState`. This navigation owns the token, so
  it owns cleanup.
- **superseded** → `superseded`. A newer navigation owns the token. The loser must not
  touch shared state: it abandons its fresh instances and leaves the outgoing unit for the
  winner (tearing it down would rip it out from under a mid-flight morph).

## Gotchas

- Entry checks: a push to the committed path is a no-op only when nothing is in flight;
  with a navigation in flight it supersedes (and rewrites the committed entry rather than
  stacking a duplicate). A second push to the in-flight target returns the first push's
  promise, so `await router.push(p)` always means "p landed or failed". Guard redirects are
  exempt from the join, or a guard redirecting to its own path would await itself.
- A pop is asymmetric: the browser already moved the URL, so commit contributes only title
  (and memory index); every non-committing exit on a pop must restore the committed URL.
- `entering` isn't awaited, so the machine is idle when the commit window closes. A push or
  replace from a `mounted()` hook lands in that window: it is parked in one last-wins slot
  and re-dispatched afterwards, and its promise settles with that navigation.
- A skeleton view opts out of the LOAD gate, not the machine: its failure lands after
  commit, so the URL names a page showing its loading state. On prerender takeover at
  navigation zero the exemption is suppressed.
- Post-commit failures (render, `mounted()`) never re-enter this machine; they belong to
  [[STATE-VIEW-LIFECYCLE]]: the commit stands and only the failed position is replaced.
