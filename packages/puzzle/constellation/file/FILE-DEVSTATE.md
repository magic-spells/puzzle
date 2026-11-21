---
name: development state transfer
status: verified
path: client-runtime/devstate.js
language: javascript
summary: Dev-only snapshot and two-phase restore across full reloads.
connections:
  - COMPONENT-DEVSTATE
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# devstate.js

Dev-only state transfer across `puzzle dev` reloads ([[COMPONENT-DEVSTATE]]): the
SSE client calls `PuzzleApp.__devSnapshot()` before `location.reload()`, writing a
one-shot sessionStorage blob (store, adapter read state, keyed views' local
state) that the new boot restores at the end of `mount()`. No module swapping —
the new bundle always runs whole; only state crosses. Also owns the live-view
registry and its single observer slot.

- **Everything is behind `typeof __PUZZLE_DEV__`** (never a bare read — unbundled
  it throws ReferenceError). Production folds it and tree-shakes the registry,
  serializer and key string; `build_test.go` asserts the erasure.
- Imported by `app.js`, `PuzzleView.js` and `devtools.js`; it must never import
  `devtools.js` back (the bridge fills its observer slot instead — see
  [[FILE-DEVTOOLS]]).
