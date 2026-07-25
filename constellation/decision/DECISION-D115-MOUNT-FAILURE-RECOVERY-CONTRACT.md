---
name: >-
  D115 — mount-failure recovery keys off the shared instance, and router-adopted views are never
  torn down by the view manager
status: built
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - DOC-VIEW-LIFECYCLE
---

The failed-first-mount teardown in `mountComponent`'s rejection handler
(viewManager.js) recovers through state on the **instance**, which every vnode
generation shares, instead of through links on the mount-time vnode, which a
same-turn parent re-render replaces. And it no longer runs at all for a
Router-preloaded view — that lifetime belongs to the Router.

## Context

The July-24 hardening pass added the teardown: a component whose first
`mount()` rejects used to leave a dead instance that `patchComponent` reused
forever, so the handler destroys the child, leaves a `<!--puzzle-->`
placeholder, and nulls the vnode's `component`/`instance` links so the next
patch mounts fresh (`patch()`'s recovery branch tested
`oldVnode.component == null`).

That recovery was itself racy. `mount()` is async, so the rejection handler
runs in a microtask — and it closes over the vnode **as of mount time**. If
the parent re-renders in the same turn (a store flush, a `setData()` in the
parent's `mounted()`), `patch()` runs while `component` is still set,
`patchComponent` copies the instance onto the NEW vnode, and the handler then
fires against the orphaned old one: it destroys the instance the live tree
still points at and nulls links the live tree no longer reads. The recovery
test never fires for the surviving vnode, so every later render calls
`applyParentUpdate` on a destroyed view — a permanently blank component plus
an orphaned comment. The exact failure the teardown was written to prevent.

Separately, the handler ran for router-preloaded views (`preloaded`,
`vnode.instance != null`). The Router pins the instance, commits it
synchronously, and logs a post-commit mount failure via `#observeMount` while
expecting the failed view to stay committed until the next navigation
replaces it. The view manager destroying it underneath made `router.current`'s
view unrefreshable — and the Router never knew.

## Decision

- **Recovery keys off the instance.** The handler stashes its placeholder on
  the instance (`child.__failedPlaceholder`, the same `__`-expando convention
  as `__ref`), which both vnode generations share. `patch()`'s recovery test
  becomes `component == null || component.isDestroyed`, and the fresh mount's
  insertion ref resolves `component?.__failedPlaceholder ?? oldVnode.el` —
  guarded to ATTACHED nodes only (`parentNode === parent`, else null/append):
  the `isDestroyed` arm also catches an instance destroyed out of band (app
  code calling `view.destroy()` through a ref), where the stashed placeholder
  is absent and the vnode's `el` is a detached root — an unguarded
  `insertBefore` there throws NotFoundError and empties the container. So
  recovery works whether or not a re-render raced the microtask, and the
  placeholder is removed either way (no orphan comment).
  `isDestroyed` is the public getter; `destroyed` is the lifecycle hook
  method and is always truthy — the wrong pick would remount every component
  on every render.
- **The vnode links are still nulled** — harmless when nothing raced, and the
  classic no-race recovery path keeps working unchanged.
- **`if (!preloaded)` gates the whole teardown.** For a router-adopted view
  the handler only logs; the Router owns that lifetime (its `#observeMount`
  already logs post-commit failures, and the next navigation replaces and
  destroys the view normally).

## Alternatives rejected

- **Re-resolving the current vnode at rejection time** — the manager keeps no
  position index; there is nothing to look the live vnode up in.
- **Blocking `patchComponent` from transferring a possibly-doomed instance** —
  at transfer time the mount promise hasn't settled; the manager cannot know,
  and pessimism would break every async-data component that mounts fine.
- **Having the Router route its preloaded failures through the manager's
  teardown** — inverts ownership; the Router's post-commit contract (failed
  view stays committed, next navigation cleans up) is deliberate (D19/D61).

## Consequences

- First-mount failure + same-turn parent re-render now recovers: the next
  non-throwing render mounts a fully working component (`mounted()` fires,
  `setData()` re-renders). This was the regressed case.
- No `<!--puzzle-->` placeholder survives recovery in either the raced or
  unraced ordering.
- A post-commit router mount failure leaves `router.current`'s view live and
  refreshable; its cleanup happens at the next navigation, as the Router's
  contract always said.
- **Known cosmetic residue, deliberately unfixed:** if the raced ordering is
  followed by the parent REMOVING the failed child (a conditional toggling
  off) rather than re-rendering it, `unmount()` takes its normal path
  (`destroy()` is an idempotent no-op) and the `__failedPlaceholder` comment
  lingers in the DOM. No listeners, no vnode references it, nothing shifts —
  a stray comment node only. The completion, if it ever matters:
  `if (!child || child.isDestroyed)` in `unmount()`, removing
  `child?.__failedPlaceholder ?? vnode.el` and returning.
