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
  - DOC-SPEC-BUILD
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# devtools.js

The dev-only bridge to the DevTools extension hook
([[DECISION-D100-DEVTOOLS-BRIDGE]]; wire contract [[DOC-SPEC-BUILD]] §55). Reached
from four call sites — `PuzzleApp.mount`/`unmount`, `Store.flush`, and
`Router.#commitState` — each inside a `__PUZZLE_DEV__` block, so production DCE
folds them, the module loses its last importer, and the bridge tree-shakes out.
The build test asserts that erasure.

Constraints, each the reason a shape here looks odd:

- **Imports go one way: devtools → devstate, never back.** devstate owns the
  live-view registry and `safeState`; instead of importing this module (a cycle)
  it exposes one observer slot this module fills at registration and clears at
  teardown. Same direction with [[FILE-DEVPERF]]: this module installs a sink on
  the profiler's event bus; the profiler knows nothing of the protocol.
- **Every entry point is fail-soft and total.** Emits swallow extension-side
  throws; the request handler is synchronous and returns `{ error }` rather than
  throwing — including an `edit:record` validation failure, which goes through the
  real `record.update()` so validation applies exactly as for app code.
- **The view forest comes from live views' own vnode trees, never router
  privates.** The walk stops at each component boundary, so every instance is
  claimed by exactly one parent and roots are the unclaimed views.
- **Profile recording is aggregated here, not in the collector**
  ([[DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL]]): rows are keyed by the id this
  module hands out, and the collector's totals are process-lifetime counters
  `measureRenders()` also reads. Rows hold a view's id, never the view, so a
  recording pins nothing in memory.
- **One app slot.** `boundApp` binds at mount and only the same instance may
  unregister it; a second `PuzzleApp` in one page rebinds, then tears the bridge
  down.
- **`FRAMEWORK_VERSION` is a hardcoded literal** (the ESM bundle cannot import
  package.json) and must be bumped with package.json each release;
  `release:prep` asserts the two match.
