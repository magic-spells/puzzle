---
name: 'D140 — Prerendered DOM restored when a takeover mount fails'
status: built
connections:
  - COMPONENT-ROUTER
  - COMPONENT-SSG
  - DECISION-D130-TAKEOVER-BUILD-DEFINE
  - DOC-SPEC-BUILD
---

A takeover mount no longer destroys the prerendered page it cannot replace: both
takeover paths snapshot the prerendered child nodes (and the marker) before
clearing, and a rejected mount puts them back exactly — the user keeps the
content-complete prerendered page instead of a permanently blank one.

## Context

Both `output: 'hybrid'` (router `#takeoverSSG`) and `output: 'static'`
(`mountStatic`) cleared the prerendered markup with `replaceChildren()` *before*
running a mount that can still fail. A `data()` rejection was already safe — the
hybrid initial-nav gate fails the navigation before the swap, and `mountStatic`
awaits `assembleChain` before clearing — so the exposed window was a
`render()`/`mounted()` throw. In that window the content that was already
correct and visible (the SEO-relevant content, for hybrid; the entire page, for
static) was destroyed with no recovery path.

## Decision

- **Snapshot, then restore on rejection — not fragment mounting.** `mounted()`
  runs during the mount and the lifecycle contract lets it focus and measure;
  mounting into a disconnected `DocumentFragment` would break both. So the mount
  still happens in the live container, and the *failure* path restores.
- **Hybrid:** `#takeoverSSG` captures the child nodes + marker value and returns
  a restore callback. `#observeMount` reports the failure, destroys the failed
  instance, and first attempts D145's app error view at the same position. Only
  when no error view is configured or that view fails does it invoke the restore
  callback. The Router retains failed-chain bookkeeping so navigation away
  replaces the position normally.
- **The marker is restored too, and every container-mount branch re-runs the
  takeover clear** — including the layout-swap branch, where the marker can only
  be present after a failed navigation-#0 restore. A no-layout app self-heals on
  the next navigation (the marker re-triggers the clear); without the
  layout-swap clear, a fresh layout mounted ALONGSIDE the restored nodes —
  duplicated page. The reuse branches (`applyParentUpdate`) patch the failed
  detached tree, so the restored prerendered content simply stays visible —
  stale-but-real beats the old permanent blank.
- **Static:** `mountStatic` drives the root's mount directly (snapshot → clear →
  `root.mount` → restore + `destroy()` on rejection, with `mountComponent`'s log
  message). `playIn()` stays OUTSIDE the mount try — a rejected enter hook must
  never tear down a mounted component (the two-arg `then()` rule) — and an
  unmarked `prerender: false` page keeps the original mount path byte-for-byte.
- `__PUZZLE_TAKEOVER__` folding is unchanged: the guarded block owns the
  snapshot and callback, so a plain SPA build still drops it all.

## Consequences

- With `errorView`, a failed takeover shows live authored error UI. Otherwise it
  shows stale-but-real prerendered content with dead interactivity and logs —
  strictly better than a blank page, but not a working app.
- Restoration happens on the rejection microtask; the container is empty only
  between the synchronous clear and the rejection, never across a paint.

## Alternatives rejected

- **`DocumentFragment` mount + single atomic swap** — the original
  recommendation; rejected because `mounted()` hooks run against connected DOM
  by contract (focus, layout measurement).
- **Leaving it** — the window is narrow, but a blank page is the worst possible
  failure for output marketed for SEO.
