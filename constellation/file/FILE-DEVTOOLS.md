---
name: DevTools runtime bridge
status: verified
path: client-runtime/devtools.js
language: javascript
summary: >-
  Dev-only bridge to the DevTools extension hook: protocol-v1 events out, snapshot/inspect/edit
  requests in.
connections:
  - DECISION-D100-DEVTOOLS-BRIDGE
  - COMPONENT-DEVSTATE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-STORE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
verified_at: '2026-07-24T23:40:00.000Z'
verified_sha: 8f349ab8b27dbd3d86f819b25d0e0bfa3d51cf69
---

Source binding for [[DECISION-D100-DEVTOOLS-BRIDGE]]; the wire contract itself
is [[DOC-SPEC]] §55. This card anchors that plan to `client-runtime/devtools.js`.

The module is reached from four call sites — `PuzzleApp.mount`/`unmount`,
`Store.flush`, and `Router.#commitState` — each already inside a
`__PUZZLE_DEV__` block, so production DCE folds them, the module loses its last
importer, and the whole bridge tree-shakes out. That erasure is asserted by the
build test, not assumed.

Durable constraints, each the reason a shape here looks odd:

- **Import direction is one-way: devtools → devstate, never back.** devstate
  owns the live-view registry and `safeState`; rather than import this module
  (a cycle), it exposes a single observer slot this module fills at
  registration and clears at teardown.
- **Every entry point is fail-soft and total.** The bridge inspects the app; it
  may never break it. Emits swallow extension-side throws, and the request
  handler is synchronous and returns `{ error }` rather than throwing —
  including for a validation failure from `edit:record`, which goes through the
  real `record.update()` so §20 applies exactly as it does to app code.
- **The view forest is built from live views' own vnode trees, never router
  privates.** The walk stops at each component boundary, so every instance is
  claimed by exactly one parent and roots fall out as the unclaimed views.
- `FRAMEWORK_VERSION` is a hardcoded literal — the runtime has no version
  constant and the ESM bundle cannot import package.json — so it must be bumped
  with package.json at every release. `plan.md`'s release checklist carries the
  reminder.
