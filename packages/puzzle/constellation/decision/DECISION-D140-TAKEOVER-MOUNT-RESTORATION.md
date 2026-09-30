---
name: 'D140 — Prerendered DOM restored when a takeover mount fails'
status: verified
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DECISION-D130-TAKEOVER-BUILD-DEFINE
  - DOC-SPEC-BUILD
verified_at: '2026-08-16T04:37:40.501Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

## Context

`output: 'hybrid'` (router `#takeoverSSG`) and `output: 'static'`
(`mountStatic`) clear the prerendered markup before running a mount that can
still fail. A `data()` rejection is already safe (the hybrid nav-#0 gate fails
before the swap; `mountStatic` awaits `assembleChain` before clearing), but a
`render()`/`mounted()` throw would leave a blank page in place of correct,
SEO-relevant content.

## Decision

Snapshot the prerendered child nodes and the takeover marker before clearing;
on a rejected mount, restore them exactly.

- **Hybrid:** `#takeoverSSG` returns a restore callback. `#observeMount`
  reports the failure, destroys the failed instance, and first tries D145's
  app error view at that position; only with no error view (or a failing one)
  does it restore. The Router keeps failed-chain bookkeeping so navigating away
  replaces the position normally.
- **The marker is restored too, and every container-mount branch re-runs the
  takeover clear** — including the layout-swap branch, or a fresh layout mounts
  beside the restored nodes (duplicated page). Reuse branches
  (`applyParentUpdate`) patch the failed detached tree, so the restored content
  stays visible.
- **Static:** `mountStatic` drives the root mount itself (snapshot → clear →
  `root.mount` → on rejection restore + `destroy()` + log). `playIn()` stays
  outside the mount try so a rejected enter never tears down a mounted
  component. An unmarked `prerender: false` page uses the plain mount path.
- The snapshot and callback live inside the `__PUZZLE_TAKEOVER__` block, so an
  SPA build drops them.

## Alternatives

- Mount into a `DocumentFragment`, then swap atomically — `mounted()` runs
  against connected DOM by contract (focus, measurement).

## Consequences

- With `errorView`, a failed takeover shows the authored error UI; without, it
  shows stale-but-real prerendered content with dead interactivity plus a log.
- The container is empty only between the synchronous clear and the rejection
  microtask, never across a paint.
- Negative result: a field report of `mounted()` measuring a 0×0 rect during
  static takeover did not reproduce. `mountStatic` mounts into the connected
  container and viewManager inserts each element before children mount and
  before `mounted()`. Get a minimal repro before touching the mount path
  (unloaded fonts/images or an ancestor `display:none` are as likely).
