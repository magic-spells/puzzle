---
name: D136 — anchor-race enter deferral, failure recovery, leave inertness, start-abort teardown
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
---

# D136 — anchor-race enter deferral, failure recovery, leave inertness, start-abort teardown

## Context

An anchor-race first mount (skeleton path) resolves `mount()` early while the
view still sits on a comment anchor (`#pendingMountHook` set). That early
resolve stays. Four gaps around it and around leaving views needed containment,
extending D115/D118.

## Decision

**1. Deferred enter (`#enterPending`).** `playIn()` while `#pendingMountHook` is
set records `#enterPending` and returns instead of spending `#playedIn` on the
anchor. `#swapLoaded` runs `#completeMount()` (`mounted()` on the real root),
then replays `playIn()`. Order holds: `mounted()` → `viewWillShow` →
in-animation → `viewDidShow`. `skipEnter()` clears the flag (router
one-animator rule).

**2. Anchor-race failure recovery.** A fire-and-forget refresh failure (parent
prop update or store change, sync or async) while `#pendingMountHook` is set
means the first render can never commit. The shared D145 failure path asks the
view's manager to plant a position marker and destroys the instance. Without
an app error view, the next parent patch mounts a fresh instance (D115); with
one, the error view holds the position until retry or owner replacement.
Routed retry is recognized from Router state.

**3. Leave inertness.** A leaving view is inert from `playOut()` start:
- It unsubscribes from the store immediately, and `refresh()`, `setData()`,
  `onStoreChange()`, `applyParentUpdate()`, `#commit()`, `#swapLoaded()` and
  `#completeMount()` early-return on `#leaving` beside `#destroyed`. The
  render/mount guards matter because a component with hide hooks but no
  `animations.out` also goes through `destroyAnimated()`, so removal is async.
- `#leaving` is set BEFORE `viewWillHide` fires, so the guards cover the hook
  window and a re-entrant `playOut()` memoizes. DOM listeners stay attached.
- Two fields, two lifetimes: `#outTask` marks the out animation spent forever
  (a later leave swaps out instantly); `#leaving` is only the current inert
  interval. A later real leave re-arms a fresh `#leaving` and unsubscribes again.
- A navigation that fails mid-leave restores the view via
  `_restoreFromLeaving()`: clears `#leaving`, cancels the animation fill, fires
  `viewWillShow` then `viewDidShow` (each contained separately, reported as
  phase `enter`), and refreshes once to re-track subscriptions.
- Hooks are not spent with the animation (D28): the spent-`#outTask` branch
  runs its own zero-duration `viewWillHide → viewDidHide` as an async task
  (`#startOverlapLeave` feeds `playOut()` into `Promise.all`, so a sync throw
  would escape). `viewDidHide()` is guarded on `#leaving` still set, so a
  cancelled leave never announces a hide.
- A leave on a never-mounted view (first `data()` pending) makes it inert but
  fires no hide bracket — hooks pair with a completed mount.

**4. `router.start()` abort parity.** `PuzzleApp.mount()` claims `_mounted`
before awaiting `router.start()`. A rejected start (navigation #0 commit
failure) runs the `beforeMount` abort pattern: epoch-guarded `#teardown()`,
rethrow. Router-owned post-commit `render()`/`mounted()` failures are reported
and replaced locally under D145 and do not reject `start()`.

## Alternatives

- Keep `mount()` pending until first paint — breaks the skeleton contract and
  can deadlock callers awaiting mount inside commit windows.
- Unsubscribe at post-animation `destroy()` — a mid-leave store flush re-renders
  the fading element (resurrected content, clicks on deleted records).

## Consequences

Amends SPEC §12/§34 and the D115/D118 contracts. Pointer events on a fading
element are an app concern.
