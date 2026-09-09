---
name: >-
  D118 — user lifecycle hook errors are contained at every boundary, and mount cycles carry a
  generation token
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ANIMATIONS
  - COMPONENT-DEVSTATE
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: all five containment fixes + mount epoch landed with revert-proven tests
    sha: 47b929360bc00d6c19b4b39113a4b502e7957952
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/viewManager.js
---

Four containment gaps closed in one round, all with the same posture the
framework already used elsewhere (the beforeUnmount and enter-hook guards):
a **user hook may fail; the framework's own bookkeeping may not be skipped
because of it** — log and continue. Plus one staleness gap: `PuzzleApp.mount()`
continuations now prove they still own the app before acting.

## The four containment fixes

- **`destroyed()` is guarded.** It was the last unguarded user hook on the
  teardown path: a throw escaped through the parent's `#vm.clear()` cascade,
  `Router.stop()`, and `PuzzleApp.#teardown()`, stranding the app with
  `_mounted` still true — a later `mount()` was a silent no-op. Now
  try/caught + logged, same as the beforeUnmount guard. `destroy()` stays
  synchronous; a returned promise is not awaited.
- **The visible-trigger reveal path guards both hooks.** `reveal()` called
  `viewWillShow()` before `handle.play()` — a throw left the paused enter
  animation holding content at `from` (typically opacity 0) forever, and
  `playIn()` never settled; a throwing `viewDidShow()` inside the finished
  continuation skipped `#settleEnter()`. Both violated §39's never-stranded
  hard rule the code itself cites. Now: hooks are guarded, `play()` and
  `#settleEnter()` are guaranteed to run.
- **`render()` → null clears.** A hand-written `render()` (compiled templates
  always emit a root) returning a vnode on one pass and null on the next left
  the stale DOM in place silently. Null now clears the manager's tree AND
  re-anchors a comment at the departing root's position — `clear()` alone
  leaves `element` null (parents resolve insertion refs from it) and a later
  render would APPEND to a container shared with siblings. Gated on
  `currentTree`: null on the first render stays a no-op, repeated nulls never
  stack comments.
- **devstate emits balanced pairs.** `unregisterView` notified the D100
  observer unconditionally, so destroying a constructed-but-never-mounted
  view emitted a `mounted:false` with no preceding `mounted:true`. It now
  notifies only when the registry delete actually removed the view.

## The mount generation token

`mount()` re-checked only the `_mounted` boolean after its await points
(beforeMount, `router.start()`), which cannot distinguish "MY mount is still
live" from "a NEWER mount claimed the flag": unmount + remount during an
awaited hook let the stale continuation start the router on the new cycle's
state or fire `mounted` against the wrong cycle. A private `#mountEpoch`
increments at every `mount()` entry and in `#teardown()`; each continuation
captures its epoch and bails on mismatch. The beforeMount abort path only
tears down its OWN cycle — a stale catch rethrows without touching the newer
cycle's state.

## Alternatives rejected

- **Letting hook throws propagate** ("fail loud") — the throw lands in
  framework internals mid-cascade, so what actually breaks is unrelated
  bookkeeping far from the user's bug; the console.error names the real
  culprit instead.
- **An AbortController per mount** instead of the epoch — heavier, and every
  await site still needs the same check; the integer answers the only
  question asked ("am I stale?").
