---
name: 'D136 — anchor-race enter deferral, failure recovery, leave inertness, start-abort teardown (v1.64)'
status: verified
connections:
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
  - DECISION-D118-LIFECYCLE-HOOK-CONTAINMENT
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-APP
  - DOC-SPEC-VIEW
  - DOC-VIEW-LIFECYCLE
  - FILE-PUZZLE-VIEW
  - FILE-VIEW-MANAGER
verified_at: '2026-08-24T05:28:08.520Z'
verified_sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
notes:
  - kind: verified
    text: >-
      Restore now fires the show bracket (viewWillShow → viewDidShow) instead of leaving it dangling
      — PR #84.
    sha: 22f27a91b0f62867d3a819c30f4456c66a811a6d
  - kind: gotcha
    text: >-
      §3 leave inertness applies to a never-mounted view, but the hide bracket does not: a leave on
      a view whose first data() is still pending makes it inert and fires nothing, because hooks and
      the out animation pair with a completed mount (D28). Inertness is about what a leaving view
      may still do; the bracket is about whether it was ever shown.
---

# D136 — anchor-race enter deferral, failure recovery, leave inertness, start-abort teardown (v1.64)

Four lifecycle containments (D118's sequel), from C2/C3/I5/I10 of the
2026-07-27 pass-2 review. Change A — an anchor-race superseded first mount
resolves `mount()` early — is PRESERVED throughout; what changes is what
happens around it.

## 1. Deferred enter (`#enterPending`)

`playIn()` invoked while `#pendingMountHook` is set no longer burns the
one-shot `#playedIn` against the comment anchor (which fired
`viewWillShow`/`viewDidShow` BEFORE `mounted()` and lost the enter animation
forever). It records `#enterPending` and returns; the landing commit's
`#swapLoaded` runs `#completeMount()` first (`mounted()` on the real root),
then replays `playIn()` fire-and-forget. The documented order — `mounted()` →
`viewWillShow` → in-animation → `viewDidShow` — now holds on the real element
for anchor-race mounts. `skipEnter()` clears the pending flag too (a deferred
enter must still be suppressible by the router's one-animator rule).

**Rejected:** keeping `mount()` pending until first paint — it changes the
skeleton contract (mount deliberately resolves early there) and risks
deadlocking callers that await mount inside commit windows.

## 2. Anchor-race failure recovery

A fire-and-forget refresh failure (parent prop update or store-change, sync
or async) that lands while `#pendingMountHook` is set means the first render
can never commit — previously a permanently blank comment, invisible to
ViewManager recovery because the mount promise had already resolved.
Now the shared D145 failure path asks the view's manager to plant the exact
position marker and destroys the instance. The normal parent reference is
enough for component retry; routed retry is recognized from Router state.
With no app error view, the next parent patch mounts a FRESH instance as D115
requires. With one, a fresh error view occupies the marker until explicit retry
or owner replacement. Deliberately eager: deterministic owner-driven recovery
beats waiting for a hypothetical later refresh to succeed.

## 3. Leave inertness

A leaving view is inert from `playOut()` start: it unsubscribes from the
store immediately (not at post-animation `destroy()`), and `refresh()`,
`setData()`, `onStoreChange()`, `applyParentUpdate()`, `#commit()`,
`#swapLoaded()`, and `#completeMount()` gain a `#leaving` early-return beside
their `#destroyed` guard. Previously a store flush mid-leave re-ran `data()`
and re-rendered the fading element (resurrected content, double-action clicks
on deleted records); the three render/mount guards matter because a component
declaring only hide HOOKS — no `animations.out` — now also routes through
`destroyAnimated()`, so ordinary removal became asynchronous and an async
`data()` could otherwise land `mounted()` and a render after the parent had
already removed the child. `#leaving` is installed BEFORE `viewWillHide` fires
so the guards cover the hook window and a re-entrant `playOut()` memoizes. DOM
listeners stay attached — pointer-events on a fading element are an app-level
concern.

Inertness lasts for the leave, not for the instance. A navigation can FAIL
mid-leave (a guard blocks it, its `data()` rejects) while this view is still the
committed one, and the router then restores it — so the state `playOut()` set has
to be undoable. Two fields carry the two different lifetimes: `#outTask` marks the
out sequence SPENT forever, so a later navigation away swaps the restored unit out
instantly with no second animation, while `#leaving` names only the CURRENT inert
interval. `_restoreFromLeaving()` clears `#leaving`, cancels the animation fill,
and refreshes once to re-track the store subscriptions `playOut()` dropped.

A later real leave takes the spent-`#outTask` branch: it builds `#leaving` a
FRESH promise (it is not re-armed from `#outTask`, which only ever records that
the animation is spent) and unsubscribes again. Without that second arming a
restored view would leave while still reactive — inertness is a property of
leaving, not of having left once.

The HOOKS are not spent with the animation. `viewWillHide`/`viewDidHide` are
lifecycle, not animation callbacks (D28), so the spent branch carries its own
zero-duration `viewWillHide → viewDidHide` bracket — the same treatment a view
declaring the hooks and no animation already gets. It runs as an async task, not
bare calls, because `#startOverlapLeave` passes `playOut()` straight into a
`Promise.all()` where a synchronous hook throw would escape the `.catch`.
Symmetrically, `viewDidHide()` is guarded on `#leaving` still being set, so a
view whose leave was CANCELLED by a restore does not announce a hide while it is
visible, live and re-subscribed.

`_restoreFromLeaving()` also fires the show bracket: `viewWillShow()` then
`viewDidShow()`, zero-duration, each hook contained separately so a throwing
`viewWillShow` still lets `viewDidShow` fire and neither can reject the
router's navigation promise or skip the refresh that follows. A view pulled
back onto screen resumes exactly as it would on a fresh show — its eventual
real leave still fires the full `viewWillHide → viewDidHide` pair through the
spent-`#outTask` branch above.

## 4. `router.start()` abort parity

`PuzzleApp.mount()` claims `_mounted` before the awaited `router.start()`; a
rejected start (navigation #0 failing its commit) previously left the app
claiming mounted with live listeners while `mount()` rejected. The await now
carries the exact `beforeMount` abort pattern: epoch-guarded `#teardown()`,
rethrow. Router-owned post-commit `render()`/`mounted()` failures are observed,
reported, and locally replaced under D145; they do NOT reject `start()`. Only
genuine navigation-#0 commit rejections reach this path.

Amends SPEC §12/§34 (inline notes) and the D115/D118 contracts it extends.
