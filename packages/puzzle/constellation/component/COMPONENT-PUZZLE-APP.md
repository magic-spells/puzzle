---
name: PuzzleApp
status: verified
connections:
  - COMPONENT-STORE
  - COMPONENT-ROUTER
  - COMPONENT-FORMATTERS
  - COMPONENT-DEVSTATE
  - COMPONENT-MORPH
  - COMPONENT-SSG
  - DECISION-D66-APP-LIFECYCLE-HOOKS
  - DECISION-D185-APP-IDLE
  - DECISION-D189-AGENT-HOOKS
  - DECISION-D145-ERROR-BOUNDARIES
  - FILE-PUZZLE-APP
  - FILE-RUNTIME-ENTRY
  - DOC-SPEC-ANATOMY
verified_at: '2026-11-01T19:26:46.557Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# PuzzleApp

`client-runtime/app.js` owns one application lifetime. The public config is
[[DOC-SPEC-ANATOMY]] §2. Translations are not app config: the `i18n` service is
built from the build-served `@magic-spells/puzzle/i18n/manifest`.

## Construction vs. mount

The constructor stores config and validates only two keys: `adapter` must be the
capability from `@magic-spells/puzzle/adapter`, and `errorView` must be a
`PuzzleView` constructor. Everything else is checked in `mount()`: the hooks
(`beforeMount`, `mounted`, `beforeUnmount`, `onError`) must be functions, and the
Router it constructs throws on a `routerMode` string or a `routerBase` holding
`#`/`?`.

**The Store is created synchronously inside `mount()`**, so `app.store` throws
before mount and after unmount. External wiring does
`const p = app.mount(); wire(app.store); await p`, or lives in `beforeMount`.

## Mount order

1. Resolve the target. Under locale prefix routing ([[DECISION-D177-LOCALE-URL-PREFIXES]]),
   a set `routerMode` throws, and a plain SPA's first-visit redirect leaves
   `mount()` pending for good (the page is being replaced). A container carrying
   `data-puzzle-ssg` skips that redirect; the prerendered head script already ran it.
2. Portal host = the container's parent, else `document.body`
   ([[DECISION-D144-PORTAL]]).
3. Install the adapter capability, then build the Store. Dev warns when a model has
   `static adapter` but no capability was passed. Core never imports the subpath.
4. i18n (behind `__PUZZLE_HAS_I18N__`): `createI18n` starts loading now, so the
   fetch overlaps `beforeMount`. Manifest paths resolve under `routerBase` in path
   mode, else against the manifest's `base`; memory mode leaves `<html lang>`
   alone. A locale switch re-runs the committed location via
   `router.__failedView(null, true)`.
5. FormatterRegistry with a router-bound `link` (reads `this.router` lazily; an
   app `link` wins), then `installTranslate` for `t`.
6. Router (`focusBehavior`, `routerMode`, `routerBase`, `transitionMode` forwarded
   only when set). `ctx = { store, router, formatters, idle }`, plus `i18n` when
   configured; `idle` is the bound `app.idle` ([[DECISION-D189-AGENT-HOOKS]]).
   `onError`/`errorView` live in a WeakMap keyed by the app ctx, so ctx stays
   exactly those services; per-view ctx lookups resolve through the prototype
   chain ([[DECISION-D145-ERROR-BOUNDARIES]]).
7. Claim `_mounted`, add the `pagehide` → `store.flush()` listener, and in dev
   publish `window.__PUZZLE_APP__` and register with the DevTools bridge
   ([[FILE-DEVTOOLS]]) before navigation zero.
8. Await `beforeMount.call(app, app)`, then `i18n.__ready()`. A rejection of
   either tears down (no `beforeUnmount`) and rejects `mount()`.
9. Restore the dev store snapshot ([[COMPONENT-DEVSTATE]]), then await
   `router.start()`; a rejection takes the same teardown-and-rethrow path.
10. Restore view-local dev state; call `mounted.call(app, app)` un-awaited
    (failures report as `app-mount`, never undo the mount).

`unmount()` (idempotent): `beforeUnmount`, dev-bridge unregister, `router.stop()`,
dispose the morph handler, flush Store persistence (including writes from
`destroyed` hooks), tear down the portal outlet, clear the container, drop
services. Unregister runs BEFORE `router.stop()`, so `app-unmounted` is the
bridge's last message.

## Concurrency guards

- `mount()` latches the private `#mount()` promise until it settles: concurrent
  calls share it, so a second `mount()` during navigation zero can't resolve early
  or swallow the first's rejection.
- Each attempt claims `#mountEpoch`; any teardown burns it. Every continuation
  after an await checks it still owns the app, so unmount + remount around an await
  can't double-start the router, double-fire `mounted`, or let a stale abort tear
  down the new cycle (D118). `_mounted` only answers "is anything mounted".

## `idle()`

Contract: [[DECISION-D185-APP-IDLE]], [[DOC-SPEC-ANATOMY]] §2. Each check runs
after a frame's callbacks (`frame()` from `scheduler.js`, so a hidden tab steps on
timers) and resolves `true` after two clear checks in a row. Busy means any of:
`#mountPromise`, `scheduled()` (pending store flushes and view renders),
`store._flushScheduled`, `store._asyncTrackingChain`, `store._reading?.()` (adapter
reads), `navigating(router)`, or `i18n.__busy`. The app has no `renderTick()`;
that is a view method ([[DECISION-D188-TICK]]).

## Other responsibilities

- `mount()` is a no-op outside a DOM (the entry stays importable by
  [[COMPONENT-SSG]]) and under `__PUZZLE_CAPTURE__` (a static page entry imports
  the app only to read `app.config`; [[DECISION-D157-ADAPTER-SUBPATH]]).
- `setMorphHandler(handler)` works before or after mount and forwards to
  [[COMPONENT-ROUTER]]; a re-mount re-arms a disposed handler ([[COMPONENT-MORPH]]).
- `config.__i18n` (`{ manifest, tables, locale, navigate }`) is an internal seam
  for the testing utilities and the static kernel, not public config.
