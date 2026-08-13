---
name: PuzzleApp
status: built
connections:
  - COMPONENT-STORE
  - COMPONENT-ROUTER
  - COMPONENT-FORMATTERS
  - COMPONENT-DEVSTATE
  - COMPONENT-MORPH
  - DECISION-D66-APP-LIFECYCLE-HOOKS
  - FILE-PUZZLE-APP
  - FILE-RUNTIME-ENTRY
  - DOC-SPEC-ANATOMY
notes:
  - kind: gotcha
    text: >-
      The Store is created synchronously inside mount(), not in the constructor.
      app.store throws before mount starts and after unmount. External wiring may
      call const pending = app.mount(); wire(app.store); await pending, or live in
      beforeMount.
---

# PuzzleApp


`PuzzleApp` owns one application lifetime. The constructor is side-effect-free;
`mount()` resolves the target, creates Store/FormatterRegistry/Router,
registers the router-bound `link` formatter after the router exists (if-absent
so a config `link` wins — D79), builds `ctx = { store, router, formatters }`,
restores development state, starts navigation, and resolves to the app after
the first route lands.

Public config: `target`, `routes`, `models`, `formatters`, `apiURL`, `storage`,
`scrollBehavior`, `routerMode` (a mode object from
`@magic-spells/puzzle/router-modes`; strings throw — D159), `routerBase`,
`transitionMode`, `beforeMount`, `mounted`, `beforeUnmount`, `onError`, and
`errorView`. `errorView` is validated as a `PuzzleView` constructor immediately
at app construction. See
[[DOC-SPEC-ANATOMY]] §2 and the amendment sections.

At mount, `onError` and `errorView` are stored together in a WeakMap keyed by
the app ctx; ctx remains exactly `{ store, router, formatters }`. Contained
mount/refresh failures report through `onError` first, then a fresh error-view
instance replaces the failed view at its owned position with `{ error, info,
retry }` props ([[DECISION-D145-ERROR-BOUNDARIES]]). Teardown deletes the
WeakMap entry.

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

Every `mount()` attempt claims a private generation epoch (`#mountEpoch`),
burned by any teardown: a continuation resuming after either await proves it
still owns the app before proceeding, so unmount+remount around an awaited
`beforeMount`/`router.start()` can neither double-start the router, double-fire
`mounted`, nor let the stale abort path tear down the replacement cycle (D118).
The `_mounted` boolean stays the "is anything mounted" question only.

While mounted, the app holds a window `pagehide` listener that calls
`store.flush()`: batched persistence ([[COMPONENT-STORE]]) leaves a dirty
window between a mutation and the scheduled flush, and a reload or
programmatic navigation inside that window would otherwise lose the write.
`pagehide` fires on unload and bfcache entry (unlike `beforeunload`, reliable
on mobile). Registered once `_mounted` is claimed; removed in teardown.

Dev builds publish `window.__PUZZLE_APP__` and, in the same `__PUZZLE_DEV__`
block, register with the D100 DevTools bridge ([[FILE-DEVTOOLS]]) — after the
services are wired and before navigation zero, so the store/router are readable
and every view mount arrives as a live event rather than a replay. Teardown
unregisters **before** `router.stop()`, so `app-unmounted` is the last message
the extension sees and the chain's teardown is implied by it instead of
arriving as a burst of `view-destroyed` events for a dead app. The two gates are
deliberately not shared: the publish also tests `__PUZZLE_APP__` identity, which
a re-mount elsewhere may have moved off this instance, while the unregister must
run for the instance that actually registered. Both are no-ops when no extension
injected a hook.

`setMorphHandler(handler)` stashes the router-agnostic integration before or
after mount and forwards it to [[COMPONENT-ROUTER]]. `enableMorph(app)` uses
this seam. `mount()` is a no-op outside a DOM so an app entry remains importable
by [[COMPONENT-SSG]].

`app.store`, `app.router`, `app.formatters`, and `app.ctx` expose the live
services. The root package exports `PuzzleApp`, `PuzzleView`, `PuzzleModel`, and
`Puzzle` plus the documented error classes and compiler-support values.
