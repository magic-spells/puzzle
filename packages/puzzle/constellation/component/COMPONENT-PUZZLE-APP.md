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
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# PuzzleApp

`client-runtime/app.js` owns one application lifetime. Public config is
[[DOC-SPEC-ANATOMY]] §2 (`target`, `routes`, `models`, `formatters`, `apiURL`, `storage`,
`adapter`, `beforeRequest`, `scrollBehavior`, `focusBehavior`, `routerMode` — a mode
object, strings throw (D159) —, `routerBase`, `transitionMode`, `i18n`, the lifecycle
hooks, `onError`, `errorView`).

## Construction vs. mount

The constructor is a side-effect-free config store; only `errorView` is validated there
(must be a `PuzzleView` constructor). **The Store is created synchronously inside
`mount()`**, so `app.store` throws before mount and after unmount — external wiring does
`const p = app.mount(); wire(app.store); await p`, or lives in `beforeMount`.

`mount()` validates hooks, then builds Store → FormatterRegistry (with a router-bound
`link` registered if absent, its closure reading `this.router` lazily, D79) → Router;
`ctx = { store, router, formatters }` (+ `i18n` when configured). `focusBehavior`,
`routerMode`, `routerBase`, `transitionMode` are forwarded only when set.
`onError`/`errorView` are stored in a WeakMap keyed by the app ctx (so ctx stays exactly
those services; lookups resolve through the per-view ctx's prototype chain), deleted at
teardown ([[DECISION-D145-ERROR-BOUNDARIES]]).

## Lifecycle order

1. Validate hooks, wire services. With `config.adapter`, validate the opaque capability
   and install it before the Store; dev warns when a model has `static adapter` but no
   capability was passed. Core never imports the subpath.
2. Await `beforeMount.call(app, app)`; a rejection tears services down, skips
   `beforeUnmount`, and rejects `mount()`.
3. i18n (D175): `createI18n({ manifest, url, refresh })` is built right after the Store
   (loading overlaps `beforeMount`); `installTranslate` runs after the registry; after
   `beforeMount`, `mount()` awaits `i18n.__ready()` (rejection → same teardown).
   `refresh` is `router.__failedView(null, true)`. Manifest URLs resolve against
   `normalizeBase(routerBase)` in path mode, else the manifest's `base`, else
   `document.baseURI`; memory mode passes `lang: false`. Every line sits behind
   `__PUZZLE_HAS_I18N__`. `config.__i18n` is an INTERNAL test seam
   (`{ manifest, tables, locale }`), not public config.
4. Restore the HMR store snapshot, then await `router.start()` so navigation zero reads
   restored records; a rejected `start()` takes the same teardown-and-rethrow path (D136).
5. Restore view-local HMR state; call `mounted.call(app, app)` un-awaited (failures
   logged, never undo the mount).
6. `unmount()` (idempotent): `beforeUnmount`, dev-bridge unregister, `router.stop()`,
   dispose the morph handler, flush Store persistence (including writes from destroyed
   hooks), tear down the portal outlet, clear the container, drop services.

## Concurrency guards

- Public `mount()` wraps private `#mount()` and latches its promise (`#mountPromise`)
  until settlement, cleared in `#teardown()`: concurrent calls share it, so a second
  `mount()` during navigation zero can't resolve early or swallow the first's rejection.
- Each attempt claims `#mountEpoch`, burned by any teardown; a continuation after either
  await checks it still owns the app, so unmount + remount around an await can't
  double-start the router, double-fire `mounted`, or let a stale abort tear down the new
  cycle (D118). `_mounted` only answers "is anything mounted".

## Other responsibilities

- A window `pagehide` listener (registered once `_mounted` is claimed) calls
  `store.flush()`, so a reload inside the batched-persistence window can't lose a write.
- The Portal outlet host is the container's parent (else `document.body`), so teleported
  content survives `replaceChildren()` ([[DECISION-D144-PORTAL]]); behind
  `__PUZZLE_HAS_PORTAL__`.
- Dev: publishes `window.__PUZZLE_APP__` and registers with the D100 bridge
  ([[FILE-DEVTOOLS]]) after services are wired, before navigation zero. Teardown
  unregisters BEFORE `router.stop()`, so `app-unmounted` is the last message. The two
  gates differ on purpose: publish also checks `__PUZZLE_APP__` identity (a re-mount may
  have moved it), unregister must run for the instance that registered.
- `setMorphHandler(handler)` stashes the integration before or after mount and forwards
  it to [[COMPONENT-ROUTER]]; a re-mount re-arms a disposed handler.
- `mount()` is a no-op outside a DOM (the app entry stays importable by
  [[COMPONENT-SSG]]) and under `__PUZZLE_CAPTURE__` (a static page entry imports the app
  only to read `app.config`; [[DECISION-D157-ADAPTER-SUBPATH]]).
- `app.store`/`router`/`formatters`/`ctx` expose the live services. The root package
  exports `PuzzleApp`, `PuzzleView`, `PuzzleModel`, `Puzzle`, `PuzzleValidationError` and
  compiler-support values; `PuzzleAdapterError` lives in `/adapter`.
