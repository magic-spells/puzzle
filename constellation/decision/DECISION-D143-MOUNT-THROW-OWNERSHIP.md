---
name: 'D143 — A mounted() throw resolves by owner'
status: built
connections:
  - DECISION-D115-MOUNT-FAILURE-RECOVERY-CONTRACT
  - DECISION-D140-TAKEOVER-MOUNT-RESTORATION
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-ROUTER
  - DOC-VIEW-LIFECYCLE
---

A `mounted()` throw is handled by whoever owns the view's lifetime, and each
owner protects its own invariant:

- **Component-owned** (ViewManager children): the instance is destroyed, a
  comment placeholder holds the position, and the next parent patch mounts a
  fresh instance (D115) — a view whose `mounted()` threw is presumed
  half-initialized and is never kept.
- **Router-owned** (preloaded chain views): the view stays mounted and
  committed, and the failure is logged — the navigation's URL/title/history/
  scroll already moved atomically, so a teardown would strand a committed URL
  over an empty container with nothing in flight to fix it. A later navigation
  replaces and destroys the failed view normally. On a navigation-#0 takeover
  the prerendered content is restored instead (D140).
- **Static-kernel root** (`mountStatic`): the root is destroyed and the
  prerendered content restored — a static page has no later patch to remount
  through.

Each path's console message names its outcome, so the boundary is visible in
the console rather than only in source:

- `[puzzle] view mount failed after commit — the view stays mounted (router
  owns its lifetime):`
- `[puzzle] component mount failed — the component was destroyed and will
  remount on the next patch:`
- `[puzzle] component mount failed — the component was destroyed and the
  prerendered content restored (static pages have no later patch/remount):`

All three behaviors are pinned by tests (`tests/router.test.js`,
`tests/keyed-reconciliation.test.js`, `tests/static-kernel.test.js`,
`tests/mount-failure-recovery-race.test.js`).

## Rationale

Component integrity ("never keep a half-initialized component") and the
atomic-commit contract ("never leave a committed route with no mounted tree")
genuinely conflict when the same hook throws — no single rule satisfies both.
The per-owner split keeps each guarantee where it matters; the named messages
and the lifecycle doc make the boundary an explicit contract instead of a
surprise.

## Alternatives rejected

- **Log everywhere** — abandons D115: half-initialized components stay on
  screen and the next patch reuses the broken instance forever.
- **Tear down everywhere** — a routed view that throws leaves the user on a
  committed URL staring at an empty container the router has no re-patch step
  to fill.
