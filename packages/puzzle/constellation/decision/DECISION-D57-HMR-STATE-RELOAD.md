---
name: >-
  D57 — HMR is a state-preserving reload: snapshot/restore across the SSE reload, not per-module
  swap
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - DECISION-D27-FAST-DEV-REBUILDS
  - COMPONENT-DEV-SERVER
  - COMPONENT-PUZZLE-APP
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-STORE
  - DOC-SPEC
code_refs:
  - client-runtime/devstate.js
  - client-runtime/app.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/datastore/store.js
---

# D57 — HMR is a state-preserving reload, not a per-module swap

`puzzle dev` keeps its full-page reload, and state crosses it: store contents, adapter read state and every mounted view's local state survive a `.pzl` edit mid-flow (modal open, form half-filled, deep in a nested route). See [[DOC-SPEC]] §27.

## Why
Warm rebuilds take ~10–15 ms ([[DECISION-D27-FAST-DEV-REBUILDS]]) and the app is one bundle, so on localhost the only real cost of a reload is lost state. Per-module swap needs a browser-side module registry, a per-module compile endpoint and import-map resolution — a large surface to save a ~50 ms reload.

## Decision
- **Reload + transplant.** The new bundle always runs whole (no stale closures, no double listeners). The injected SSE client calls `window.__PUZZLE_APP__.__devSnapshot()` right before `location.reload()`, which writes a one-shot `sessionStorage` blob, `__puzzleHMR`.
- **Dev-only by define.** The build defines `__PUZZLE_DEV__` (`true` in dev, `false` in production, where minification strips every guarded branch — zero production bytes). The runtime probe treats an **undefined** define as dev, so the unbundled runtime (vitest, a foreign bundler) keeps the hooks present but inert.
- **Snapshot** (`client-runtime/devstate.js`), each step fail-soft:
  - the store's records in the `_persist()` wire shape, plus the adapter read state ([[DECISION-D161-AUTO-FETCHING-FINDS]]) so a save does not refetch complete collections; in-flight requests are not carried;
  - each live view's **local layer** only (`setData` + `created()` state, via `_localState()`), filtered to JSON-safe plain values — functions, DOM nodes, records and anything containing them are dropped, because `data()` re-derives them from the restored store. Keyed `${class name}:${per-class mount index}`, deterministic because the same URL mounts the same chain in the same order;
  - the route travels in the URL (history/hash). Memory mode has no dev-server story.
- **Restore in two phases**, inside `PuzzleApp.mount()`: read and delete the blob (discard it if older than 10 s, so a manual F5 cold-starts); **before** the initial navigation, hydrate the store in replace mode (the snapshot overrides duplicate-pk records from configured `storage`) and then the read state; **after** it, `setData(saved)` into each live view whose key matches. Any failure means a cold start, never a crash.
- **The edited component restores too.** Keeping a form's state while editing that form is the point; keys the new `data()` no longer reads are inert.

## Known edges (dev-only, fail-soft)
Focus and selection are lost; islands re-seed; a skeleton-gated view whose `data()` commits after restore can clobber restored defaults; class-name collisions or a data-driven mount order can mis-key a view (it cold-starts).

## Alternatives rejected
- esbuild-native module HMR — esbuild has no HMR runtime; the registry, endpoint and import maps would all be ours.
- In-page whole-bundle re-execution without reload — two live module graphs, doubled globals, leak-prone teardown.
- Injecting `sessionStorage` as the app's `storage` — changes app semantics (per-write persistence nobody opted into).
- Per-changed-file restore skip — deferred until restore-all misbehaves in practice.
