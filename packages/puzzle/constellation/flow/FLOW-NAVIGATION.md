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
  - COMPONENT-SSG
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
  - DECISION-D119-ROUTER-SETTLEMENT-ANNOUNCEMENT
  - DECISION-D56-OVERLAP-TRANSITIONS
  - DECISION-D67-SSG-STATIC-BUILD
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
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

# Navigation pipeline

What runs, in what order, for one navigation — and which step each failure mode
belongs to. The phases and their terminal outcomes are modelled in
[[STATE-NAVIGATION]]; the instance-level machine steps 6 and 9 drive is
[[STATE-VIEW-LIFECYCLE]].

The shape of the whole thing is **load, then leave, then commit**. Nothing that
the user can observe moves until the last step that can still fail has passed.

1. **Request.** `push()`, `replace()`, an intercepted same-origin link click, a popstate (back/forward or `go()`), or navigation zero from `router.start()`.
   - a target matching the committed path is a no-op — no history entry, no `data()` re-run, no scroll change
   - a target matching the *in-flight* navigation's path returns that navigation's own promise, so a double-click settles once, at its commit
   - a request made from inside the commit window is parked in one last-wins slot and re-dispatched through the public verb after the window closes
2. **Match** the path against the flattened leaf matchers, in declaration order, with the top-level `*` catch-all checked last; a trailing slash is insignificant.
   - no match and no catch-all → warn and stay, with the cancellation token deliberately left alone
3. **Claim the token and freeze the snapshot** — `{ path, pathname, query, hash, route, params, chain }`, parsed once — and capture the departure scroll position now, while the outgoing page still has its full height.
4. **Run the guard chain** root → leaf, sequentially, before any view or layout is constructed.
   - `false` or a throw → stay put; a blocked popstate rewrites the address bar back to the committed route
   - a path string → redirect through `replace()`, so the denied URL never enters history; ten redirects without an intervening commit trip the cycle cap
   - a newer token across an awaited guard → abandon silently
5. **Plan the chain.** Diff old and new route-node chains by identity: `keep` is the shared-prefix length, clamped back past any instance sitting inside a still-animating outgoing unit. Fresh view instances are constructed for `[keep..N]`; the layout is reused unless its class changed.
6. **LOAD — the gate.** Fresh views `preload()` (constructor → `created()` → `data()`, entirely off-DOM); reused ancestors `prepareRefresh()`, which runs `data()` against the destination and commits nothing. All of it is awaited together.
   - gated loads must all *start* before any skeleton-exempt preload opens its tracking scope, or the gate queues behind the very fetch the exemption exists to skip
   - a fresh view declaring `<puzzle-skeleton>` starts its preload unawaited — except at navigation zero over prerendered markup, where it is awaited so real content replaces real content in a single swap
   - a rejection → report `phase: 'navigation'`, destroy the fresh instances, discard every prepared ancestor handle, restore a stalled leaver, stay put
   - a newer token → the same teardown, reported nowhere
7. **Assemble the chain leaf-up** into nested keyed component vnodes — every level, not only the divergent one. Reused levels keep their committed key so the patch reuses the instance; fresh levels get a key stamped with this navigation's token so they can never collide with a destroyed predecessor.
8. **OUT phase.** Sequential (the default) plays the outgoing unit's `viewWillHide` → `out` → `viewDidHide`, awaits any morph-leave, then destroys it. Overlap pins the leaver at its measured rect and falls straight through without awaiting. An interrupted earlier transition is torn down synchronously and this navigation skips its own out.
   - a throwing leave hook is logged and the swap continues — a rejected leave must never strand the preloaded incoming chain
9. **COMMIT — one synchronous window.** Location first (URL or entry stack, `document.title`, the outgoing scroll save), then the mount or keyed patch of the incoming chain, then router state: committed `#state`, the prepared reused-ancestor commits, the scroll landing, and finally focus plus the live-region announcement. A reused layout's chrome `data()` re-runs last, after state, so it reads a fresh `router.current`.
10. **Post-commit, pre-paint.** The topmost swapped instance plays its `in` animation fire-and-forget (every fresh instance below it is suppressed — one animator per transition), the morph handler pairs the freshly mounted subtree against the surviving DOM, and any push a `mounted()` hook deferred is dispatched.

## The atomic commit set

Step 9 is the only step with observable effects, and everything in it lands or
nothing does:

| Moved | Notes |
|---|---|
| URL + history entry | `pushState`, or `replaceState` keeping the entry's scroll key; a urlless mode moves its stack and index instead |
| `document.title` | resolved nearest-defined leaf to root; memory mode deliberately does no document work |
| outgoing scroll position | saved under the departing entry's key, from the value captured at step 3 |
| the mounted tree | mount or keyed patch of the full assembled chain |
| committed router state | path, query, params, chain, instances, keys, layout |
| reused-ancestor state | params, route snapshot, model, and store subscriptions, committed from the prepared handles |
| scroll landing | after mount, before paint, so a restore never flashes the old offset |
| focus + announcement | strictly after scroll, focused with `preventScroll` so it cannot fight it |

## What can fail, and where

- **Steps 1–2** cannot fail destructively. They decline.
- **Step 4** fails as a verdict, not an exception: blocked, redirected, or
  superseded. Nothing has been constructed yet, which is exactly why guards run
  here.
- **Step 6** is the last step that can fail *cheaply*. Fresh instances exist but
  own nothing on screen; ancestors have run `data()` but hold only a prepared
  handle. Both are disposable, and disposing them is what makes the D19
  guarantee true rather than aspirational.
- **Step 8** can be superseded but not failed — a throwing leave hook is
  contained.
- **Steps 9–10 cannot be undone.** A render or `mounted()` throw here surfaces
  as a rejected mount promise: the commit stands, the URL is correct, and only
  the failed position is replaced — by the app `errorView` or, with none
  configured, an invisible recovery placeholder. At navigation zero over
  prerendered markup the error view gets first refusal; only if none renders is
  the prerendered content restored.

## Why ancestors are transactional

A reused ancestor is on screen. Re-running its `data()` against the destination
is how it gates the URL and how `this.route` names the navigation being gated —
but applying that run immediately would mean a rejected navigation left a
visible ancestor already describing a route the app never reached. So the run
is prepared during the gate and committed inside step 9, alongside everything
else. Every non-committing exit path must discard the handles, or the tracked
subscriptions strand on a live ancestor.

## Output modes

Hybrid output runs this pipeline unchanged; navigation zero recognises the
prerender marker, clears it inside the commit window, and skips the initial
enter animation. True static output has no router at all — those pages are
mounted by the static kernel, and no step here applies to them.
