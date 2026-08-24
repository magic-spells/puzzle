---
name: HMR with state preservation
status: verified
verified_at: '2026-08-24T21:11:50.859Z'
connections:
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D27-FAST-DEV-REBUILDS
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - DOC-SPEC
  - FILE-DEVSTATE
  - FILE-PUZZLE-APP
  - FILE-DEV-SERVER
  - FILE-BUILD-OPTIONS
  - FILE-TESTS-HMR-DEV-RELOAD-TEST
notes:
  - kind: verified
    text: >-
      Verified: tests/hmr-dev-reload.test.js (13 — end-to-end transplant, one-shot + expiry +
      corrupt-blob fail-soft, safe-filter units, window publish/clear, storage-less safety) + Go
      TestBuildDevDefineDCE (dev bundle keeps __puzzleHMR/__PUZZLE_APP__, prod DCEs both) + dev.go
      client test; live proof on examples/todos: dev build carries the hooks, prod build's only
      residue is the inert empty __devSnapshot method (48128 B). Gotcha baked into the code + test:
      the __PUZZLE_DEV__ probe MUST be spelled inline at each gate — a hoisted `const DEV` does not
      constant-propagate into class-method scopes and left dead `Z && …` guards in the prod bundle
      (measured, fixed in review). 532 vitest + all Go green.
  - kind: verified
    text: >-
      v1.32: two-phase restore (body updated) — store transplants pre-nav-#0 in _hydrateAll replace
      mode (HMR beats configured storage on duplicate pks, identity preserved), view-local layer
      restores post-mount; snapshots serialize view._localState() only (derived values recomputed,
      never pinned). Fixes the masked bug where store-derived views rendered empty until the next
      mutation after a dev reload. DCE guard green; hmr-dev-reload.test.js grew
      first-paint/override/derived-recompute coverage.
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
release: RELEASE-V0-1-0
change: feature
---

# v1.25 — State-preserving development reload

Shipped via [[DECISION-D57-HMR-STATE-RELOAD]] and hardened before release.
Puzzle deliberately uses a full-page reload with state transfer, not per-module
hot replacement.

## Behavior

Before the injected SSE client reloads the page,
`window.__PUZZLE_APP__.__devSnapshot()` stores one short-lived, one-shot blob in
`sessionStorage` key `__puzzleHMR` (~10s expiry). The blob carries store
records, each view's JSON-safe local `setData` layer, and — when the adapter
capability is installed — the D161 adapter read state, captured fail-soft
through the capabilities relay. Fresh boot restores in two phases:

1. after `beforeMount` but before navigation zero, the store hydrates in
   identity-preserving replace mode, then the read state is handed to
   `hydrateReadState` — records first, so an absence whose record crossed the
   reload is dropped; in-flight request promises never cross;
2. after the routed tree mounts, each view's JSON-safe local `setData` layer
   restores by stable class/mount identity.

`data()`-derived values, model instances embedded in local state, functions,
and DOM nodes are not serialized; the fresh app recomputes them. The URL keeps
the route and router scroll persistence handles position.

Every step is fail-soft and snapshots expire quickly. Production defines the
development flag false so snapshot/restore branches are removed by esbuild. The
`__PUZZLE_DEV__` probe must be spelled inline at each gate — a hoisted
`const DEV` does not constant-propagate into class-method scopes, so esbuild
cannot eliminate the branches; `TestBuildDevDefineDCE` guards the regression.

## Acceptance

Editing a component during a nested route preserves store contents and sibling
local form state while loading the new bundle. The store is available to the
first routed `data()` evaluation. [[FILE-TESTS-HMR-DEV-RELOAD-TEST]] and build
define tests cover the transfer and production dead-code path.

Per-module DOM-preserving hot replacement remains intentionally unshipped.
