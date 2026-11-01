---
name: Navigation pipeline
status: verified
triggers:
  - kind: manual
connections:
  - STATE-NAVIGATION
  - STATE-VIEW-LIFECYCLE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - FILE-ROUTER
  - FILE-ROUTE-TREE
  - DOC-SPEC-ROUTER
  - DOC-VIEW-LIFECYCLE
  - DECISION-D19-NAVIGATION-COMMIT
  - DECISION-D61-ATOMIC-LOCATION-COMMIT
  - DECISION-D30-NESTED-ROUTES
  - DECISION-D47-ROUTE-SNAPSHOT
  - DECISION-D87-ROUTE-GUARDS
  - DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH
  - DECISION-D145-ERROR-BOUNDARIES
  - DECISION-D39-SKELETON
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D84-HEAD-MANAGEMENT
  - DECISION-D93-ROUTER-FOCUS-MANAGEMENT
  - DECISION-D56-OVERLAP-TRANSITIONS
  - DECISION-D163-LAZY-ROUTE-VIEWS
  - DECISION-D182-NAVIGATION-RESULT
  - DECISION-D67-HYBRID-PRERENDER
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
verified_at: '2026-11-01T19:25:13.521Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Navigation pipeline

What runs, in what order, for one navigation, and which step owns each failure. The phases and terminal outcomes are modelled in [[STATE-NAVIGATION]]; the per-instance machine that steps 7 and 10 drive is [[STATE-VIEW-LIFECYCLE]]. The contract is [[DOC-SPEC-ROUTER]]; implementation traps are in [[COMPONENT-ROUTER]].

The shape is **load, then leave, then commit**: nothing the user can see moves until the last step that can fail has passed. Every exit resolves the caller's `push()`/`replace()` with a `NavigationResult` ([[DECISION-D182-NAVIGATION-RESULT]]).

1. **Request.** `push()`, `replace()`, an intercepted same-origin link click, a popstate (back/forward or `go()`), or navigation zero from `router.start()`.
   - the committed path, with the chain intact and nothing in flight → no-op: no history entry, no `data()`, no scroll change; resolves `ok`
   - the committed path while something is in flight, or over an invalidated chain → a real navigation with replace semantics (an ordinary push over a path/hash-mode pop in flight)
   - the *in-flight* navigation's path → that navigation's own promise, so a double-click settles once, at its commit
   - a request from inside the commit window is parked in one last-wins slot and re-dispatched after the window closes; a displaced entry resolves `'superseded'`
2. **Match** the path against the flattened leaf matchers in declaration order, the top-level `*` catch-all last; a trailing slash is insignificant.
   - no match and no catch-all → warn, stay, resolve `'not-found'`; the cancellation token is left alone
3. **Claim the token and freeze the snapshot** — `{ path, pathname, query, hash, route, params, chain }`, parsed once — and capture the departure scroll position while the outgoing page still has its full height.
4. **Run the guard chain** root → leaf, sequentially, before any view or layout exists ([[DECISION-D87-ROUTE-GUARDS]]).
   - `false` → stay put (`'blocked'`); a throw → stay put (`'error'`, reported to `onError`); a blocked popstate rewrites the address bar back to the committed route
   - a path string → redirect with the denied verb — `push()` for a push, `replace()` for a pop or navigation zero; the denied URL never enters history; ten redirects without a commit trip the cycle cap (`'error'`)
   - a newer token across an awaited guard → abandon silently (`'superseded'`)
5. **Resolve `lazy()` markers** for the whole chain in one `Promise.all` ([[DECISION-D163-LAZY-ROUTE-VIEWS]]); a rejection is a pre-commit failure like a `data()` rejection in step 7.
6. **Plan the chain.** Diff old and new route-node chains by identity: `keep` is the shared-prefix length, clamped back past any instance inside a still-animating outgoing unit. Fresh instances are constructed for `[keep..N]`; the layout is reused unless its class changed. A constructor throw is a pre-commit failure (instances dropped, never destroyed).
7. **LOAD — the gate.** Fresh views `preload()` (constructor → `created()` → `data()`, off-DOM); reused ancestors `prepareRefresh()`, which runs `data()` against the destination and commits nothing ([[DECISION-D146-TRANSACTIONAL-ANCESTOR-REFRESH]]). All of it is awaited together.
   - gated loads must all *start* before any skeleton-exempt preload opens its tracking scope, or the gate queues behind the fetch the exemption exists to skip
   - a fresh view with `<puzzle-skeleton>` starts its preload unawaited — except at navigation zero over prerendered markup, where it is awaited so real content replaces real content in one swap
   - a rejection → report `phase: 'navigation'`, destroy the fresh instances, discard every prepared ancestor handle, restore a stalled leaver, repair a pop's URL, stay put (`'error'`)
   - a newer token → the same teardown, reported nowhere (`'superseded'`)
8. **Assemble the chain leaf-up** into nested keyed component vnodes — every level, not only the divergent one. Reused levels keep their committed key so the patch reuses the instance; fresh levels get a key stamped with this navigation's token so they never collide with a destroyed predecessor.
9. **OUT phase.** Sequential (the default) plays the outgoing unit's `viewWillHide` → `out` → `viewDidHide`, awaits any morph-leave, then destroys it. Overlap pins the leaver at its measured rect and falls straight through ([[DECISION-D56-OVERLAP-TRANSITIONS]]). An interrupted earlier transition is torn down synchronously and this navigation skips its own out.
   - a throwing leave hook is logged and the swap continues — a rejected leave must never strand the preloaded incoming chain
10. **COMMIT — one synchronous window** ([[DECISION-D61-ATOMIC-LOCATION-COMMIT]]). Location first (URL or entry stack, `document.title`, the outgoing scroll save), then the mount or keyed patch of the incoming chain, then router state: committed state, the prepared ancestor commits, the scroll landing, and finally focus plus the live-region announcement. A reused layout's chrome `data()` re-runs last, so it reads a fresh `router.current`. Resolves `ok`.
    - a synchronous throw here → `'error'`; the URL and DOM may already be on the target while `router.current` names the old route, so the chain is marked invalid and the next navigation rebuilds every level; only navigation zero rethrows, so `mount()` tears down
11. **Post-commit, pre-paint.** The topmost swapped instance plays its `in` fire-and-forget (every fresh instance below it is suppressed — one animator per transition), the morph handler pairs the new subtree against the surviving DOM, and any navigation a `mounted()` hook deferred is dispatched.
