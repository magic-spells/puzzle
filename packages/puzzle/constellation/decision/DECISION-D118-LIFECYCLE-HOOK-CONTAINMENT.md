---
name: >-
  D118 — User lifecycle hook errors are contained at every boundary; mount cycles carry a generation
  token
status: verified
connections:
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ANIMATIONS
  - COMPONENT-DEVSTATE
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/views/viewManager.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/app.js
  - client-runtime/devstate.js
---

# D118 — User lifecycle hook errors are contained; mount cycles carry a generation token

**A user hook may fail; the framework's own bookkeeping may not be skipped
because of it.** Hook throws are caught and reported (the error names the real
culprit), and the framework continues.

## Containment rules

- **`destroyed()` is guarded.** An escaping throw would abort the teardown
  cascade (`#vm.clear()` → `Router.stop()` → `PuzzleApp.#teardown()`) and strand
  `_mounted` true, making a later `mount()` a silent no-op. `destroy()` stays
  synchronous; a returned promise isn't awaited.
- **Visible-trigger reveals (D73) guard both show hooks.** A throwing
  `viewWillShow()` must not leave the paused enter holding content at `from`
  forever, and a throwing `viewDidShow()` must not skip `#settleEnter()` — content
  is never stranded (SPEC §39).
- **A hand-written `render()` returning null after a vnode clears** the manager's
  tree and re-anchors a comment at the departing root's position (else a later
  render would append to a shared container). Null on the first render is a
  no-op; repeated nulls don't stack comments.
- **devstate emits balanced pairs:** `unregisterView` notifies (D100) only when
  the registry delete removed something, so a never-mounted view emits no
  unmatched `mounted:false`.
- App hooks follow the same posture (D66).

## Mount generation token

`PuzzleApp.mount()` awaits (`beforeMount`, `router.start()`), and the
`_mounted` boolean can't tell "my mount is live" from "a newer mount claimed the
flag". A private `#mountEpoch` increments at every `mount()` entry and in
`#teardown()`; each continuation captures its epoch and bails on mismatch. The
`beforeMount` abort path tears down only its own cycle — a stale catch rethrows
without touching the newer cycle.

## Alternatives

- **Let hook throws propagate** — they land mid-cascade and break unrelated
  bookkeeping far from the bug.
- **An AbortController per mount** — heavier, and every await site still needs
  the same check.
