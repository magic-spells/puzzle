---
name: "D66 — App lifecycle hooks: beforeMount / mounted / beforeUnmount on the PuzzleApp config"
status: verified
connections:
  - FEATURE-APP-SURFACE
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D57-HMR-STATE-RELOAD
  - COMPONENT-PUZZLE-APP
  - DOC-SPEC
verified_at: '2026-07-14T17:04:46.083Z'
notes:
  - kind: verified
    text: >-
      Verified at ship (1600ce7): runtime exactly as decided — awaited beforeMount pre-navigation-#0
      with abort-teardown skipping beforeUnmount, non-awaited mounted post-HMR-restore with both
      error channels logged, sync beforeUnmount pre-teardown, mount()-time non-function validation,
      unmount()/#teardown() split. All ten seed-after-mount examples swept to beforeMount; music's
      seedReady export + six view preambles deleted. 13 new tests; 553 vitest + all Go green.
---

# D66 — App lifecycle hooks: `beforeMount` / `mounted` / `beforeUnmount`

Settled (v1.31). Three optional function fields on the PuzzleApp config —
`beforeMount(app)`, `mounted(app)`, `beforeUnmount(app)` — give app-level
setup and teardown a sanctioned home. This is the **triage** of the
[[FEATURE-APP-SURFACE]] umbrella that card demanded: lifecycle hooks are
admitted on proven demand; every other member is **re-rejected** (below).

## Context

Ten of the fifteen example apps end with the same unsanctioned idiom:
`app.mount().then(() => { …seed the store… })`. It has a real ordering flaw —
seeding after mount means navigation #0's `data()` ran against an empty
store — and the music example is the smoking gun: it exports a `seedReady`
promise that six views `await` at the top of `data()`, a hand-rolled
pre-navigation hook. Three examples additionally register app-level
`visibilitychange`/`beforeunload` persistence listeners with no sanctioned
teardown point. The cut list (D8) had always spelled the deferred hooks
`beforeMount, mounted, …` — this ships that spelling.

## Decision

Config gains three optional fields (all omitted → byte-identical behavior,
like every amendment since `scrollBehavior`, D33):

- **`beforeMount(app)`** — invoked inside `mount()` after the three ctx
  services are wired (`app.store`, `app.router`, `app.formatters` all live)
  and the mounted flag is claimed, immediately **before `router.start()`**
  (navigation #0). **Awaited** — an async hook finishes before the first
  `data()` runs, so store seeding lands where it always belonged. A throw or
  rejection **aborts the mount**: the app is torn back down to the unmounted
  state and `mount()` rejects with the hook's error (fail-fast; no
  half-mounted app; a later `mount()` retry is legal). If `unmount()` is
  called while an async `beforeMount` is in flight, the router never starts —
  same guard the initial navigation already has.
- **`mounted(app)`** — invoked after `router.start()` resolves (initial route
  rendered), after the unmount-during-mount guard, and after the dev HMR
  restore (D57 — restored state is visible to the hook). **Not awaited**; a
  sync throw or async rejection is caught and logged (`[puzzle]` console
  error) and never rejects a `mount()` that in fact succeeded — the same
  "logged, never wedges" posture as morph-handler errors (D55).
- **`beforeUnmount(app)`** — invoked at the top of `unmount()`, after the
  idempotency guard (never fires on a never-mounted/already-unmounted app),
  **before any teardown** — services are still live, so persistence flushes
  can read the store. Called synchronously (`unmount()` stays sync); a
  returned promise is not awaited (it cannot delay teardown); a throw is
  caught and logged, and teardown always proceeds. It does **not** fire on
  the beforeMount-abort path — it pairs with a *completed* mount.

Shared rules:

- Each hook receives the app instance as its sole argument (and `this` is the
  app for `function`-form hooks; arrows should just use the argument).
- A non-function, non-nullish value for any hook field is a `mount()`-time
  throw, before any wiring (the constructor stays a side-effect-free config
  store, SPEC §2).
- Hooks re-fire on every mount/unmount cycle of the same instance.
- `beforeMount` delays navigation #0 — seed local/fast data there; a slow
  network fetch belongs in view `data()` behind a `<puzzle-skeleton>` (D39),
  which cannot render during `beforeMount`.

## Triage: the rest of the umbrella, re-rejected

- **App-level `settings` / `computed` / `methods`** — a module constant or a
  singleton store record covers every observed need; zero example demand.
- **Global `events` incl. keyboard-shortcut strings** — every keydown
  listener in all fifteen examples is *view-scoped* (dialogs, drag machines),
  correctly paired in `mounted()`/`destroyed()`; in-template keys are covered
  by D38 key filters. No app-global shortcut (no cmd-k palette) exists in the
  corpus, and shortcut strings drag in parsing + focus-suppression design.
  Reopen only with a real consumer.
- **Global event bus `this.$events`** — the open question is now answered by
  evidence: the music app does cross-view signaling with singleton store
  records (`player`, `toast`) and it reads naturally. Store records ARE the
  bus. Re-rejected.
- **`ctx.utils`** — the 3-service `ctx` is a stated selling point (D8);
  utilities are an import away.
- **Devtools hook** — no pull pre-publish; `window.__PUZZLE_APP__` (D57)
  already exposes the running app in dev builds.

## Rejected alternatives (for the admitted member)

- **A `hooks:`/`lifecycle:` sub-object** — flat optional config fields match
  the `scrollBehavior`/`routerMode` amendment grammar; a nested object is a
  second place to look.
- **Awaiting `mounted`** — would delay `mount()`'s resolution on app code the
  framework no longer needs, and turn a post-success hook failure into a
  spurious mount rejection.
- **An `unmounted` (post-teardown) hook** — nothing left to read; no demand.
- **View-vocabulary naming (`created`/`destroyed`)** — the cut list already
  promised `beforeMount`/`mounted`; app teardown is opt-in `unmount()`, not
  view destruction.
- **Instance methods / emitter registration (`app.on('mounted', …)`)** — the
  config literal is the app's one declaration site (D8).

## Consequences

- Third-ever amendment family on the §2 config surface; all fields optional,
  existing apps byte-identical.
- The examples' `mount().then(seed)` idiom is retired in favor of
  `beforeMount` (swept in this ship); music's exported `seedReady` promise —
  and the six `await seedReady` view preambles — are deleted outright.
- `app.store`'s "available once mount() has been called" contract is
  unchanged; `beforeMount` runs inside that window, so `app.store` (and the
  `app` argument's `.router`/`.formatters`) are safe there.
- A `beforeMount` rejection now tears down what `mount()` had wired — the
  previously-unreachable "mount rejected" state is specified rather than
  accidental.
