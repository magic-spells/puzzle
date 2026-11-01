---
name: development state transfer
status: verified
path: client-runtime/devstate.js
language: javascript
summary: Dev-only snapshot and two-phase restore across full reloads.
connections:
  - COMPONENT-DEVSTATE
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
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
