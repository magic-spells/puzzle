---
name: DOM view manager
status: verified
path: client-runtime/views/viewManager.js
language: javascript
summary: >-
  VNode mount, patch, keyed reconciliation, Component ranges, composition, events, islands and
  teardown.
connections:
  - COMPONENT-VIEW-MANAGER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

Source binding for the owning component card. Behavioral intent stays in the connected component; this card anchors that plan to `client-runtime/views/viewManager.js`.

D180 immediate selection teardown carries a gated synchronous context through a selected component's own `ViewManager.clear()`. If its render root is another component, that descendant is destroyed before replacement creation even when hide hooks or out animations would otherwise defer removal.

Keyed moves, replacement insertion refs and unknown-tree recovery brackets use the complete vnode range, resolving recursively through component roots to selection or live-HTML ends. `PuzzleView.elementEnd` delegates to the owning manager recursively; keyed reconciliation reuses `moveComponentSlot(parent, vnode, ref, end)` for selected and live-HTML ranges, including ordinary component wrappers.
