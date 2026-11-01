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
verified_at: '2026-11-01T19:26:46.557Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Development reload state

`client-runtime/devstate.js` implements the state-preserving full reload
([[DECISION-D57-HMR-STATE-RELOAD]]). It is not module hot replacement: every
successful dev rebuild reloads the new bundle (no stale closures or partial
graphs), and a one-shot sessionStorage blob carries state across.

**Snapshot.** Right before `location.reload()`, the injected dev client calls
`PuzzleApp.__devSnapshot()`. It stores the Store's persistence wire shape, each
mounted view's JSON-safe local state (keyed by class name + per-class mount
order), and the adapter read state (`blob.read`, `serializeReadState` via the
`capabilities.js` relay, fail-soft), so a code save neither refetches collections
nor re-404s ([[DECISION-D161-AUTO-FETCHING-FINDS]]). In-flight promises never
cross. The filter keeps finite primitives, arrays and plain objects; it drops
functions, DOM nodes, class instances, cycles, over-depth values and store-derived
model values.

**Restore** is two-phase. After `beforeMount`, before navigation zero, records
hydrate in identity-preserving replace mode, then `hydrateReadState` applies
(records first, so a stale absence is dropped). After the route chain mounts,
local view state is applied with `setData()`. Blobs are deleted before parsing,
expire after 10 s (`MAX_AGE_MS`), and every step fails soft to a cold start. App
persistence (localStorage) stays records-only.

**Live-view registry**, shared with the DevTools bridge
([[DECISION-D100-DEVTOOLS-BRIDGE]]). The bridge imports `safeState`/`liveViewList`
from here, so to avoid a cycle devstate holds one nullable `viewObserver` slot
that [[FILE-DEVTOOLS]] fills at hook registration. `registerView`/`unregisterView`
call it after updating the set; `unregisterView` only when a view was actually
removed, so a never-mounted destroy emits no unbalanced `mounted:false`.
`liveViewList()` returns views in mount order so the bridge can replay views that
mounted before it attached.

Everything sits behind inline `__PUZZLE_DEV__`, written as positive
`if (DEV) { … }` blocks: esbuild eliminates a constant-false branch but not
statements after an early `return`. A build test proves none of it survives in
production output.
