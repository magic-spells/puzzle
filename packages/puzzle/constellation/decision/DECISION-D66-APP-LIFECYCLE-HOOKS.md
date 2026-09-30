---
name: "D66 — App lifecycle hooks: beforeMount / mounted / beforeUnmount on the PuzzleApp config"
status: verified
connections:
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D57-HMR-STATE-RELOAD
  - COMPONENT-PUZZLE-APP
  - DOC-SPEC
verified_at: '2026-07-14T17:04:46.083Z'
code_refs:
  - client-runtime/app.js
---

# D66 — App lifecycle hooks: `beforeMount` / `mounted` / `beforeUnmount`

Three optional function fields on the PuzzleApp config give app-level setup and
teardown a sanctioned home. Each receives the app as its only argument (`this`
is also the app for `function`-form hooks). A non-function, non-nullish value
(for these and `onError`) throws at `mount()` time, before any wiring — the
constructor stays a side-effect-free config store. Hooks re-fire on every
mount/unmount cycle of the same instance.

## Decision

- **`beforeMount(app)`** — inside `mount()`, after `app.store`, `app.router`
  and `app.formatters` are wired and the mounted flag is claimed, immediately
  before `router.start()` (navigation #0). **Awaited**, so store seeding lands
  before the first `data()`. A throw/rejection aborts the mount: the app tears
  back down and `mount()` rejects with the hook's error; a retry is legal.
  `unmount()` during an in-flight `beforeMount` means the router never starts
  (D118's mount epoch guards stale continuations).
- **`mounted(app)`** — after `router.start()` resolves and after the dev HMR
  restore (D57). **Not awaited**; a sync throw or rejection goes to
  `reportError` (phase `app-mount`) and never rejects a successful `mount()`.
- **`beforeUnmount(app)`** — top of `unmount()`, after the idempotency guard,
  before any teardown (services still live, so persistence can flush).
  Synchronous; a returned promise is observed but not awaited; errors are
  reported (phase `app-unmount`) and teardown always proceeds. Does not fire on
  the `beforeMount` abort path — it pairs with a completed mount.

`beforeMount` delays navigation #0: seed local/fast data there; slow fetches
belong in view `data()` behind a skeleton (D39), which cannot render during
`beforeMount`.

## Alternatives

- **A `hooks:`/`lifecycle:` sub-object** or **`app.on('mounted', …)`** —
  rejected: flat optional config fields are the amendment grammar; the config
  literal is the app's one declaration site (D8).
- **Awaiting `mounted`** — rejected: a post-success hook failure would become a
  spurious mount rejection.
- **An `unmounted` post-teardown hook** — nothing left to read.

## Rest of the app-surface umbrella — rejected until a real consumer appears

- App-level `settings`/`computed`/`methods`: a module constant or singleton
  store record covers it.
- Global `events` / keyboard-shortcut strings: every observed keydown listener
  is view-scoped; D38 key filters cover templates.
- A global event bus: singleton store records are the bus.
- `ctx.utils`: utilities are an import away; `ctx` stays three services (D8).
