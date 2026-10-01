---
name: D100 — DevTools runtime bridge + wire protocol
status: verified
connections:
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D60-DROP-CONSOLE-OPT-OUT
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - COMPONENT-PUZZLE-APP
  - COMPONENT-STORE
  - COMPONENT-ROUTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-DEVSTATE
  - DOC-SPEC
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/devtools.js
  - client-runtime/app.js
  - client-runtime/router/router.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/datastore/store.js
  - client-runtime/devstate.js
---

# D100 — DevTools runtime bridge + wire protocol

The framework ships a dev-only **runtime bridge** (`client-runtime/devtools.js`)
speaking a versioned wire protocol; the Chrome extension lives in
`packages/puzzle-devtools` (`private: true`, released as a zip) and never imports
framework internals. The protocol contract is SPEC §55.

## Decision

- **Not app config.** Zero config surface and zero production bytes: the
  extension injects `window.__PUZZLE_DEVTOOLS_HOOK__` at `document_start` and
  the bridge notices it; absent the hook, every notify is a no-op.
  `window.__PUZZLE_APP__` (D57) stays the manual-console story. (D60's rejection
  of an app-config devtools hook still holds.)
- **Bridge shape** follows `devstate.js`: module-scope `DEV` const, inline
  `__PUZZLE_DEV__` probes at call sites. Hooks are one-liners beside existing
  dev-gated code — app mount/unmount (`__PUZZLE_APP__` publish/clear), store
  `_deliverNotifications` (flush keys + notified set), router `#commitState`
  (`devtoolsRouteCommit`), and devstate's `registerView`/`unregisterView`.
  `PuzzleView` carries inert readers `_modelState()`, `_localState()`,
  `_vnodeTree()`.
- **Protocol:** envelope `{ puzzle: 1, v: 1, type, payload }`. Events `hello`,
  `app-mounted`, `app-unmounted`, `view-mounted`, `view-destroyed`, `flush`,
  `route-commit`; requests `snapshot:views|records|subscriptions|route`,
  `inspect:view`, `edit:record` (through `record.update()`, so validation
  applies), `highlight:view`, `log:view|record` (binds `$p`). Messages grow
  additively without a version bump (D122 added the profiler set). Versions are
  exchanged in `hello`; the panel shows a mismatch state rather than misrender.
- **View tree** is derived by walking live views' vnode trees
  (`vnode.component`) — roots are views that are no one's child — never by
  reading router private state.
- `hello` reports a hardcoded `FRAMEWORK_VERSION`, which `release:prep` asserts
  against `package.json` (a stale literal makes every panel misreport).
- The extension (MV3: page hook buffers until a panel connects → content
  script → background worker → panel) is itself a Puzzle app; its internals
  live on its own cards.

## Consequences

- `TestBuildDevDefineDCE` pins that production bundles contain no
  `__PUZZLE_DEVTOOLS_HOOK__`.
- The flush event rides D63's batching — no extra throttling.

## Alternatives

- **Extension-side monkey-patching of `__PUZZLE_APP__`** — drifts with every
  release and relies on unminified dev builds.
- **An event-emitter API on `PuzzleApp`** — public surface for a dev tool.
- **A side panel or a rebuilt console panel** — wrong register / redundant.
