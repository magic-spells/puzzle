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
  comment placeholder holds the position, and the app error view mounts there
  when configured. Without one, the next parent patch mounts a fresh instance
  (D115). A view whose `mounted()` threw is never kept.
- **Router-owned** (preloaded chain views): the failed view is likewise
  destroyed and replaced at its exact committed position. The Router keeps the
  URL/title/history/scroll commit, marks the failed chain non-reusable, owns
  navigation-away cleanup, and retries by forcing its normal same-location
  replacement (`keep = 0`). On navigation-zero takeover, the error view gets the position first;
  only its absence/failure restores prerendered content (D140/D145).
- **Static-kernel root** (`mountStatic`): the root is destroyed and the
  prerendered content restored — a static page has no later patch to remount
  through.

Each path's console message names its outcome, so ownership is visible in
the console rather than only in source:

- `[puzzle] routed view mount failed — the failed position was replaced:`
- `[puzzle] component mount failed — the component was destroyed and will
  remount on the next patch:`
- `[puzzle] component mount failed — the component was destroyed and the
  prerendered content restored (static pages have no later patch/remount):`

All three behaviors are pinned by tests (`tests/error-boundaries.test.js`, `tests/router.test.js`,
`tests/keyed-reconciliation.test.js`, `tests/static-kernel.test.js`,
`tests/mount-failure-recovery-race.test.js`).

## Rationale

Component integrity ("never keep a half-initialized component") and the
atomic-commit contract ("never roll back a committed route asynchronously")
coexist through exact-position replacement. The route remains committed while
its failed unit is replaced locally, and ownership still determines retry and
cleanup.

## Alternatives rejected

- **Log everywhere** — abandons D115: half-initialized components stay on
  screen and the next patch reuses the broken instance forever.
- **Tear down without a replacement position** — a routed view that throws
  would leave a committed URL over an empty container. D145's stable marker and
  error view close that gap.
