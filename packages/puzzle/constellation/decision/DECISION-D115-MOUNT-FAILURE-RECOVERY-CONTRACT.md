---
name: D115 — Mount-failure recovery keys off the shared instance and owned position
status: verified
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-ROUTER
  - DOC-VIEW-LIFECYCLE
verified_at: '2026-08-16T04:33:10.083Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

# D115 — Mount-failure recovery keys off the shared instance and owned position

A component whose first `mount()` rejects is destroyed and replaced by a
`<!--puzzle-->` placeholder so the next patch mounts fresh. The rejection
handler runs a microtask later and closes over the mount-time vnode, but a
same-turn parent render (a store flush, `setData()` in the parent's `mounted()`)
may already have copied the instance onto a new vnode. So recovery keys off
state **every vnode generation shares** — the instance and its owned position —
never the mount-time vnode's links.

## Decision

- The handler stashes the placeholder on the instance
  (`child.__failedPlaceholder`, the `__`-expando convention). `patch()` recovers
  when `component == null || component.isDestroyed`, inserting at
  `component?.__failedPlaceholder ?? oldVnode.el` — **only if that node is still
  attached** to the parent (else append). The `isDestroyed` arm also catches an
  instance destroyed out of band (app code calling `view.destroy()` via a ref),
  whose `el` is a detached root; an unguarded `insertBefore` there throws and
  empties the container. The placeholder is removed either way.
- **`isDestroyed` is the getter; `destroyed` is the lifecycle hook method**
  (always truthy) — using the wrong one remounts every component on every render.
- With an app `errorView` (D145), the failed position keeps its replacement on
  same-identity patches without auto-retrying; removal destroys the error view
  and marker. Without one, the next parent patch mounts fresh.
- **Router-preloaded views are replaced too:** the Router marks a failed
  chain/layout non-reusable; retry replaces the current location so the normal
  pipeline rebuilds the chain and commits fresh bookkeeping only after its load
  gate succeeds. A post-commit mount failure keeps the committed URL (D61)
  while the failed position shows the error view or marker.

## Alternatives

- **Re-resolve the current vnode at rejection time** — the manager keeps no
  position index.
- **Block `patchComponent` from transferring a possibly-doomed instance** — the
  mount promise hasn't settled at transfer time; pessimism would break every
  async-data component.
