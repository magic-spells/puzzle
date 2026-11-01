---
name: PuzzleView runtime
status: verified
path: client-runtime/views/PuzzleView.js
language: javascript
summary: Component state, lifecycle, tracking, refs, memo, skeleton, and animation orchestration.
connections:
  - COMPONENT-PUZZLE-VIEW
verified_at: '2026-11-01T19:28:54.178Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# PuzzleView.js

The base class of every compiled view, layout and component
([[COMPONENT-PUZZLE-VIEW]]): a plain class (no custom element, no shadow DOM)
owning state, lifecycle and update scheduling; `viewManager.js` owns the DOM. The
compiler attaches `render()` after the user's class.

- **Every app pulls this in.** It must never import `views/listBlock.js` (D170
  byte gate) or anything else optional; dev-only helpers sit behind
  `__PUZZLE_DEV__`.
- The base class never reads `this.events` (class fields initialize after
  `super()`), except for the dev-only handler/library-name collision warning at
  mount.
- A null render captures `elementEnd.nextSibling` before teardown, so the
  placeholder and a later remount land outside the departing range and before
  trailing siblings.
