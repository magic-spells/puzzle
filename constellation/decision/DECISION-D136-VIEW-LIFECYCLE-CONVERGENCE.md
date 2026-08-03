---
name: 'D136 — anchor-race enter deferral, failure recovery, leave inertness, start-abort teardown (v1.64)'
status: built
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
Now `#handleBackgroundRefreshFailure` plants the D115 placeholder (the shared
`plantFailedMountPlaceholder`, factored out of `mountComponent`'s rejection
handler), destroys the instance, and stashes `__failedPlaceholder` so the
next parent patch mounts a FRESH instance. Deliberately eager: a
deterministic remount beats waiting for a hypothetical later refresh to
succeed. Router-preloaded views never set `#pendingMountHook` (preload
resolves before their synchronous mount) and are untouched.

## 3. Leave inertness

A leaving view is inert from `playOut()` start: it unsubscribes from the
store immediately (not at post-animation `destroy()`), and `refresh()`,
`setData()`, `onStoreChange()`, and `applyParentUpdate()` gain a `#leaving`
early-return beside their `#destroyed` guard. Previously a store flush
mid-leave re-ran `data()` and re-rendered the fading element (resurrected
content, double-action clicks on deleted records). `#leaving` is installed
BEFORE `viewWillHide` fires so the guards cover the hook window and a
re-entrant `playOut()` memoizes. DOM listeners stay attached — pointer-events
on a fading element are an app-level concern.

Inertness lasts for the leave, not for the instance. A navigation can FAIL
mid-leave (a guard blocks it, its `data()` rejects) while this view is still the
committed one, and the router then restores it — so the state `playOut()` set has
to be undoable. Two fields carry the two different lifetimes: `#outTask` holds the
spent out sequence forever, so a later navigation away swaps the restored unit out
instantly with no second animation, while `#leaving` names only the CURRENT inert
interval. `_restoreFromLeaving()` clears `#leaving`, cancels the animation fill,
and refreshes once to re-track the store subscriptions `playOut()` dropped; a
later real leave re-arms `#leaving` from the spent `#outTask` and unsubscribes
again. Without that second arming a restored view would leave while still
reactive — inertness is a property of leaving, not of having left once.

## 4. `router.start()` abort parity

`PuzzleApp.mount()` claims `_mounted` before the awaited `router.start()`; a
rejected start (navigation #0 failing its commit) previously left the app
claiming mounted with live listeners while `mount()` rejected. The await now
carries the exact `beforeMount` abort pattern: epoch-guarded `#teardown()`,
rethrow. Note the D115 boundary: router-owned post-commit `render()`/
`mounted()` failures are observed-and-logged and do NOT reject `start()` —
only genuine navigation-#0 commit rejections reach this path.

Amends SPEC §12/§34 (inline notes) and the D115/D118 contracts it extends.
