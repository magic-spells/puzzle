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
