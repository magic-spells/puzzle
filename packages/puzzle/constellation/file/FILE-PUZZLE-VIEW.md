---
name: PuzzleView runtime
status: verified
path: client-runtime/views/PuzzleView.js
language: javascript
summary: Component state, lifecycle, tracking, refs, memo, skeleton, and animation orchestration.
connections:
  - COMPONENT-PUZZLE-VIEW
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `client-runtime/views/PuzzleView.js`.

Null-render clearing captures the sibling after the manager's complete `elementEnd` before teardown, keeping its placeholder and later remount outside the departing range and before trailing siblings.
