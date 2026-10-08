---
name: Runtime component selection range
status: built
path: client-runtime/views/componentSlot.js
language: javascript
summary: Imported constructor selection and stable DOM ranges for the Component built-in.
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-SSG
  - DECISION-D180-COMPONENT-SLOT
  - FEATURE-COMPONENT-SLOT
---

Source binding for the D180 `dynamicComponent` helper and range lifecycle. Behavioral intent lives in [[COMPONENT-VIEW-MANAGER]] and [[DECISION-D180-COMPONENT-SLOT]]; this module selects only supplied constructors and delegates child components to the normal mount/patch/teardown paths.

Only changing `is` uses immediate child teardown. Removing the slot itself calls ordinary unmount so the selected child's hide hooks and leave transition run. Its range mover also accepts a resolved end from the manager for a component-root selection or live-HTML range.
