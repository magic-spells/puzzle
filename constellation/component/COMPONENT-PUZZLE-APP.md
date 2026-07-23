---
name: PuzzleApp
status: verified
connections:
  - COMPONENT-STORE
  - COMPONENT-ROUTER
  - COMPONENT-FORMATTERS
  - COMPONENT-DEVSTATE
  - COMPONENT-MORPH
  - DECISION-D66-APP-LIFECYCLE-HOOKS
  - FILE-PUZZLE-APP
  - FILE-RUNTIME-ENTRY
notes:
  - kind: gotcha
    text: >-
      The Store is created synchronously inside mount(), not in the constructor.
      app.store throws before mount starts and after unmount. External wiring may
      call const pending = app.mount(); wire(app.store); await pending, or live in
      beforeMount.
verified_at: '2026-07-22T01:03:39.466Z'
---

# PuzzleApp


`PuzzleApp` owns one application lifetime. The constructor is side-effect-free;
`mount()` resolves the target, creates Store/FormatterRegistry/Router,
registers the router-bound `link` formatter after the router exists (if-absent
so a config `link` wins — D79), builds `ctx = { store, router, formatters }`,
restores development state, starts navigation, and resolves to the app after
the first route lands.

Public config: `target`, `routes`, `models`, `formatters`, `apiURL`, `storage`,
`scrollBehavior`, `routerMode`, `routerInitialPath`, `routerBase`,
`transitionMode`, `beforeMount`, `mounted`, and `beforeUnmount`. See
[[DOC-SPEC]] §2 and the amendment sections.

Lifecycle order:

1. Validate hooks and wire services.
2. Await `beforeMount.call(app, app)`; a rejection tears services down, skips
   `beforeUnmount`, and rejects `mount()`.
3. Restore the HMR store snapshot, then await `router.start()` so navigation
   zero reads restored records.
4. Restore view-local HMR state and invoke `mounted.call(app, app)` without
   awaiting it; failures are logged and cannot undo a successful mount.
5. `unmount()` invokes `beforeUnmount.call(app, app)`, stops the router,
   flushes pending Store persistence (including mutations from destroyed
   hooks), clears the container, and drops services. It is idempotent.

While mounted, the app holds a window `pagehide` listener that calls
`store.flush()`: batched persistence ([[COMPONENT-STORE]]) leaves a dirty
window between a mutation and the scheduled flush, and a reload or
programmatic navigation inside that window would otherwise lose the write.
`pagehide` fires on unload and bfcache entry (unlike `beforeunload`, reliable
on mobile). Registered once `_mounted` is claimed; removed in teardown.

`setMorphHandler(handler)` stashes the router-agnostic integration before or
after mount and forwards it to [[COMPONENT-ROUTER]]. `enableMorph(app)` uses
this seam. `mount()` is a no-op outside a DOM so an app entry remains importable
by [[COMPONENT-SSG]].

`app.store`, `app.router`, `app.formatters`, and `app.ctx` expose the live
services. The root package exports `PuzzleApp`, `PuzzleView`, `PuzzleModel`, and
`Puzzle` plus the documented error classes and compiler-support values.
