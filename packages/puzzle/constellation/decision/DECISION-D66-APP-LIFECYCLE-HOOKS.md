---
name: 'D66 — App lifecycle hooks: beforeMount / mounted / beforeUnmount'
status: verified
connections:
  - DECISION-D08-MINIMAL-CONFIG
  - DECISION-D33-ROUTER-SCROLL
  - DECISION-D57-HMR-STATE-RELOAD
  - COMPONENT-PUZZLE-APP
  - DOC-SPEC
verified_at: '2026-11-01T19:23:12.785Z'
code_refs:
  - client-runtime/app.js
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# D66 — App lifecycle hooks: `beforeMount` / `mounted` / `beforeUnmount`

Three optional function fields on the PuzzleApp config give app-level setup and teardown a home. Each receives the app as its argument (and as `this` for `function`-form hooks). Hooks re-fire on every mount/unmount cycle of the same instance.

## Decision

- **Validation:** a non-function, non-nullish value (for these three and `onError`) throws at `mount()`, before any wiring — the constructor stays a side-effect-free config store.
- **`beforeMount(app)`** — inside `mount()`, after `app.store`, `app.router`, `app.formatters` (and `app.i18n`) are wired and the mounted flag is claimed, immediately before `router.start()` (navigation #0). **Awaited**, so store seeding lands before the first `data()`. A throw/rejection tears the app back down and `mount()` rejects with it; a retry is legal. `unmount()` during an in-flight `beforeMount` means the router never starts (the D118 mount epoch guards stale continuations).
- **`mounted(app)`** — after `router.start()` resolves and after the dev HMR restore (D57). **Not awaited**; a throw or rejection goes to `reportError` (phase `app-mount`) and never rejects a successful `mount()`.
- **`beforeUnmount(app)`** — top of `unmount()`, after the idempotency guard, before any teardown (services still live, so persistence can flush). Synchronous; a returned promise is not awaited; errors are reported (phase `app-unmount`) and teardown always proceeds. Does not fire on the `beforeMount` abort path — it pairs only with a completed mount.
- `beforeMount` delays navigation #0: seed local/fast data there; slow fetches belong in view `data()` behind a skeleton (D39).
- Under the prerender modes `beforeMount` runs at build time with a facade instead of the app (D67).

## Alternatives rejected

- **A `hooks:`/`lifecycle:` sub-object** or **`app.on('mounted', …)`** — flat optional config fields; the config literal is the app's one declaration site (D8).
- **Awaiting `mounted`** — a post-success hook failure would become a spurious mount rejection.
- **An `unmounted` post-teardown hook** — nothing is left to read.
- App-level `settings`/`computed`/`methods`, global `events`/keyboard-shortcut strings, a global event bus, `ctx.utils` — a module constant or singleton store record covers each; key filters (D38) cover templates; utilities are an import away.
