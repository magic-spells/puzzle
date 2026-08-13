---
name: D115 — mount-failure recovery keys off the shared instance and owned position
status: built
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - DOC-VIEW-LIFECYCLE
---

The failed-first-mount teardown in `mountComponent`'s rejection handler
recovers through state on the **instance and its owned position**, which every
same-identity vnode generation shares, instead of through links on the
mount-time vnode that a same-turn parent render may already have replaced.
D145 amends the old router-preload exemption: every failed view is destroyed
and replaced locally; retry re-enters the owner's existing rebuild path.

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

Router-preloaded views add a second ownership requirement. The Router pins the
instance and commits URL/title/history synchronously, so local teardown must
also mark that chain non-reusable. Explicit retry forces the Router's normal
same-location replacement; its `keep = 0` rebuild installs fresh bookkeeping.
Leaving the broken view mounted is no longer permitted.

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
- **The live failed position retains the instance.** With an app `errorView`,
  same-identity patches carry the replacement without auto-retrying; removal
  destroys the error view and marker. Without one, the next parent patch uses
  the same destroyed-instance/placeholder recovery to mount fresh.
- **Router-preloaded views are replaced too.** The Router marks a failed
  chain/layout non-reusable. Retry internally replaces the current location,
  so the ordinary navigation pipeline reruns the complete route chain and
  commits fresh bookkeeping only after its load gate succeeds.

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
- A post-commit router mount failure preserves the committed URL while the
  exact failed position shows the app error view or invisible marker. A later
  navigation disposes it; successful retry restores healthy reusable state.
- Parent removal no longer leaves cosmetic residue: unmount disposes the
  replacement and marker explicitly, while idempotent view teardown protects
  subscriptions, descendants, refs, outside listeners, and portals.
