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
verified_at: '2026-08-23T19:55:09.280Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
---

# Development reload state

Implements D57's state-preserving full reload. It is not module hot replacement: every successful dev rebuild reloads the new bundle, avoiding stale closures and partial module graphs, while a one-shot sessionStorage blob carries application state across the reload.

Immediately before `location.reload()`, the injected dev client calls `PuzzleApp.__devSnapshot()`. The snapshot stores the Store's persistence wire shape plus each mounted view's JSON-safe local state — and, since D161, the adapter read state (`blob.read`, the `serializeReadState` envelope of collection-complete types and negative identities, captured fail-soft through the capabilities relay), so a code save neither refetches full collections nor re-404s known-missing records. In-flight promises never cross; an unresolved miss simply retries after the reload. Views are keyed by class name and per-class mount order. The filter keeps finite primitives, arrays, and plain objects; it drops functions, DOM nodes, class instances, cycles, over-depth values, and store-derived model values.

Restore is two-phase. After `beforeMount` but before navigation zero, Store records hydrate in identity-preserving replace mode so the first `data()` reads restored records, then `hydrateReadState` applies the read envelope — records first, so a stale absence whose record just hydrated is dropped. After the route chain mounts, saved local view state is applied with `setData()`. Blobs are deleted before parsing, expire after ten seconds, and every step fails soft to a cold start. Application persistence (localStorage) stays records-only — read state rides only the dev snapshot.

This module also owns the **live-view registry**, which is why it grew a second
consumer: the D100 DevTools bridge needs the same set of mounted instances and
the same JSON-safe filter. Rather than have devstate import the bridge — a
cycle, since the bridge already imports `safeState` and `liveViewList` from here
— devstate holds one nullable `viewObserver` slot that [[FILE-DEVTOOLS]] fills
at hook registration and clears at teardown. `registerView`/`unregisterView`
call it after updating the set, so a mount/destroy becomes a live extension
event — `unregisterView` only when the delete actually removed the view, so a
constructed-but-never-mounted destroy cannot emit an unbalanced
`mounted:false` (D118); with no extension attached the slot is null and costs
an optional-call check. `liveViewList()` returns the set as an array **in mount order**, which is
what lets the bridge replay views that mounted before it registered.

All code is guarded by the inline `__PUZZLE_DEV__` define. Production uses a constant-false branch that esbuild removes; a build regression test proves the registry, serializer, key strings, and hooks do not remain in production output. The gates are written as positive `if (DEV) { … }` blocks rather than an early `if (!DEV) return` — esbuild reliably eliminates a constant-false branch but does not strip statements after an unconditional return.
