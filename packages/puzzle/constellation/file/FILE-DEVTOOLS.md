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
notes:
  - kind: verified
    text: >-
      Re-verified against current code in the post-monorepo sweep: every checkable claim on this
      card was found true as written, so nothing changed but the baseline. Bound code was read at
      this sha; the framework suite is green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for [[DECISION-D100-DEVTOOLS-BRIDGE]]; the wire contract itself
is [[DOC-SPEC-BUILD]] §55. This card anchors that plan to `client-runtime/devtools.js`.

The module is reached from four call sites — `PuzzleApp.mount`/`unmount`,
`Store.flush`, and `Router.#commitState` — each already inside a
`__PUZZLE_DEV__` block, so production DCE folds them, the module loses its last
importer, and the whole bridge tree-shakes out. That erasure is asserted by the
build test, not assumed.

Durable constraints, each the reason a shape here looks odd:

- **Import direction is one-way: devtools → devstate, never back.** devstate
  owns the live-view registry and `safeState`; rather than import this module
  (a cycle), it exposes a single observer slot this module fills at
  registration and clears at teardown. The same direction holds for
  [[FILE-DEVPERF]]: this module installs a sink on the profiler's event bus,
  and the profiler knows nothing about the protocol.
- **Every entry point is fail-soft and total.** The bridge inspects the app; it
  may never break it. Emits swallow extension-side throws, and the request
  handler is synchronous and returns `{ error }` rather than throwing —
  including for a validation failure from `edit:record`, which goes through the
  real `record.update()` so §20 applies exactly as it does to app code.
- **The view forest is built from live views' own vnode trees, never router
  privates.** The walk stops at each component boundary, so every instance is
  claimed by exactly one parent and roots fall out as the unclaimed views.
- **The profile recording is aggregated here, not in the collector**
  ([[DECISION-D122-DEVTOOLS-PROFILER-PROTOCOL]]), because rows must be keyed by
  the id THIS module hands out and because the collector's totals are
  process-lifetime counters `measureRenders()` also reads. Rows hold a view's
  id, never the view, so a recording pins nothing in memory.
- **The bridge holds exactly one app slot.** `boundApp` binds at mount and only
  the same instance may unregister it, so a second `PuzzleApp` in one page
  rebinds and then tears the bridge down.
- `FRAMEWORK_VERSION` is a hardcoded literal — the runtime has no version
  constant and the ESM bundle cannot import package.json — so it must be bumped
  with package.json at every release. `release:prep` asserts the two match,
  because the comment saying so was not enough on its own.
