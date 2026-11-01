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
  - DECISION-D180-COMPONENT-SLOT
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# viewManager.js

Render → diff → patch for ViewNode trees ([[COMPONENT-VIEW-MANAGER]]): DOM mount and patch, keyed reconciliation, inline component mounting (D20), slot expansion, portals, live-HTML and `<Component>` ranges, per-node listeners, islands, and teardown.

- **`ssg/serialize.js` imports `expandSlots` from here**, so slot expansion is identical in the browser and in prerendered HTML.
- **Ranges, not nodes.** A vnode may span several DOM nodes (a `<Component>` selection, live HTML, a component whose root is either). Keyed moves, insertion refs and conditional replacement all use the vnode's complete range, resolved recursively through component roots (`PuzzleView.elementEnd` delegates to its own manager). Conditional replacement captures the old range before unmount and anchors on its first node still in the parent afterward.
- **`<Component>` swaps unmount immediately** ([[DECISION-D180-COMPONENT-SLOT]]): a constructor swap tears the old instance down synchronously, bypassing hide hooks and leave animations, even through a nested component root, so the old instance is gone before the new one mounts.
- Every `<Component>` path sits behind `__PUZZLE_HAS_COMPONENT_SLOT__`, so an app that never writes `<Component>` ships none of it.
