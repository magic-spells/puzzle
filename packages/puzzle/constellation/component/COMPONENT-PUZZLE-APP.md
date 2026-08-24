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
  - DOC-SPEC-ANATOMY
notes:
  - kind: gotcha
    text: >-
      The Store is created synchronously inside mount(), not in the constructor. app.store throws
      before mount starts and after unmount. External wiring may call const pending = app.mount();
      wire(app.store); await pending, or live in beforeMount.
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# PuzzleApp


`PuzzleApp` owns one application lifetime. The constructor is side-effect-free;
`mount()` resolves the target, creates Store/FormatterRegistry/Router, builds
`ctx = { store, router, formatters }`, restores development state, starts
navigation, and resolves to the app after the first route lands. The
FormatterRegistry is built before the Router with a router-bound `link`
formatter registered if-absent, so a config `link` wins (D79); its encoder
closure reads `this.router` lazily, so it never captures a stale Router across
a re-mount and is correct even though the registry predates the Router.

Public config: `target`, `routes`, `models`, `formatters`, `apiURL`, `storage`,
`adapter`, `beforeRequest`, `scrollBehavior`, `focusBehavior`, `routerMode` (a
mode object from `@magic-spells/puzzle/router-modes`; strings throw — D159),
`routerBase`, `transitionMode`, `beforeMount`, `mounted`, `beforeUnmount`,
`onError`, and `errorView`. `errorView` is validated as a `PuzzleView`
constructor immediately at app construction; the three lifecycle hooks and
`onError` are validated at the top of `mount()`, keeping the constructor a
side-effect-free config store. `focusBehavior`, `routerMode`, `routerBase`, and
`transitionMode` are forwarded to the Router only when set, so the Router's own
defaults stand otherwise. See [[DOC-SPEC-ANATOMY]] §2 and the amendment
sections.

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
   zero reads restored records. A rejected `start()` takes the same
   epoch-guarded teardown-and-rethrow path as a rejected `beforeMount` (D136).
4. Restore view-local HMR state and invoke `mounted.call(app, app)` without
   awaiting it; failures are logged and cannot undo a successful mount.
5. `unmount()` invokes `beforeUnmount.call(app, app)`, stops the router,
   disposes the morph handler, flushes pending Store persistence (including
   mutations from destroyed hooks), tears down the portal outlet, clears the
   container, and drops services. It is idempotent.

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

`mount()` also nominates the Portal outlet host — the mount container's parent,
falling back to `document.body` — so teleported content survives the
container's `replaceChildren()` and is torn down explicitly
([[DECISION-D144-PORTAL]]). Both touchpoints sit behind D89's full inline
`__PUZZLE_HAS_PORTAL__` probe.

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
this seam; a re-mount re-arms a handler a prior unmount disposed. `mount()` is a
no-op outside a DOM so an app entry remains importable
by [[COMPONENT-SSG]], and a no-op under `__PUZZLE_CAPTURE__` so a static page's
generated entry can import that same app entry purely to read `app.config`
([[DECISION-D157-ADAPTER-SUBPATH]]) without booting an SPA over the prerendered
page. The define is false in every other pass, so the guard folds away.

`app.store`, `app.router`, `app.formatters`, and `app.ctx` expose the live
services. The root package exports `PuzzleApp`, `PuzzleView`, `PuzzleModel`,
`Puzzle`, `PuzzleValidationError`, and compiler-support values;
`PuzzleAdapterError` belongs to the opt-in `/adapter` subpath.

When `config.adapter` is present, `PuzzleApp` validates the opaque capability
and installs it before Store construction. In development, a registered model
with a truthy static adapter config and no capability warns with the model name
and the `@magic-spells/puzzle/adapter` import fix. Core never imports that
subpath; it only validates and invokes the received capability.
