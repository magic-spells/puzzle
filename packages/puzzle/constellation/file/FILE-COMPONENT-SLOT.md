---
name: Runtime component selection range
status: verified
path: client-runtime/views/componentSlot.js
language: javascript
summary: Imported constructor selection and stable DOM ranges for the Component built-in.
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-SSG
  - DECISION-D180-COMPONENT-SLOT
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# componentSlot.js

Runtime for `<Component is={…}>` ([[DECISION-D180-COMPONENT-SLOT]]):
`dynamicComponent` (the compiler-support helper a compiled module calls) plus the
mount/patch/move/unmount of the stable comment-bracketed range. Only
`viewManager.js` imports the range functions, behind `__PUZZLE_HAS_COMPONENT_SLOT__`,
so an app that never writes `<Component>` ships none of it. It selects only the
constructors it is handed and delegates the child to the normal component paths
([[COMPONENT-VIEW-MANAGER]]).

- **Only a changed `is` tears down immediately.** Removing the slot itself goes
  through ordinary unmount, so the selected child's hide hooks and leave transition
  still run.
- **Named-slot routing reads `slot` from the outer selection vnode**; consuming it
  also strips it from the selected child's props.
- **The range mover collects siblings up to the end before writing.** When the end
  is unreachable (page translation wrapped it, or moved it before the start), only
  the start moves, so external DOM edits cannot rotate siblings forever. It also
  accepts a resolved end from the manager for a component-root selection or a
  live-HTML range.
