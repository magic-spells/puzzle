---
name: Development reload state
status: verified
connections:
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - COMPONENT-DEV-SERVER
  - DECISION-D57-HMR-STATE-RELOAD
  - DECISION-D100-DEVTOOLS-BRIDGE
  - FILE-DEVSTATE
  - FILE-DEVTOOLS
  - FILE-PUZZLE-APP
  - FILE-DEV-SERVER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Development reload state

`client-runtime/devstate.js` implements D57's state-preserving full reload. It is not
module hot replacement: every successful dev rebuild reloads the new bundle (no stale
closures or partial graphs), while a one-shot sessionStorage blob carries state across.

**Snapshot**: right before `location.reload()`, the injected dev client calls
`PuzzleApp.__devSnapshot()`, which stores the Store's persistence wire shape, each mounted
view's JSON-safe local state (keyed by class name + per-class mount order), and the D161
read state (`blob.read`, the `serializeReadState` envelope via the `capabilities.js`
relay, fail-soft) so a code save neither refetches collections nor re-404s. In-flight
promises never cross. The filter keeps finite primitives, arrays and plain objects; it
drops functions, DOM nodes, class instances, cycles, over-depth values and store-derived
model values.

**Restore** is two-phase: after `beforeMount`, before navigation zero, records hydrate in
identity-preserving replace mode and then `hydrateReadState` applies (records first, so a
stale absence is dropped); after the route chain mounts, local view state is applied with
`setData()`. Blobs are deleted before parsing, expire after ten seconds, and every step
fails soft to a cold start. App persistence (localStorage) stays records-only.

**Live-view registry**: also used by the D100 DevTools bridge. To avoid a cycle (the
bridge imports `safeState`/`liveViewList` from here), devstate holds one nullable
`viewObserver` slot that [[FILE-DEVTOOLS]] fills at hook registration.
`registerView`/`unregisterView` call it after updating the set — `unregisterView` only
when the delete actually removed a view, so a never-mounted destroy emits no unbalanced
`mounted:false` (D118). `liveViewList()` returns views in mount order so the bridge can
replay ones that mounted before it attached.

Everything sits behind inline `__PUZZLE_DEV__`, written as positive `if (DEV) { … }`
blocks — esbuild eliminates a constant-false branch but not statements after an early
`return`. A build regression test proves none of it survives in production output.
