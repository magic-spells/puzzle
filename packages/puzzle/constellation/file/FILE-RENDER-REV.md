---
name: record render revision symbol
status: built
path: client-runtime/renderRev.js
language: javascript
summary: The RENDER_REV Symbol the store stamps on records and the view layer compares against.
connections:
  - COMPONENT-STORE
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
---

Source binding for the owning component cards. Behavioral intent stays in [[DECISION-D170-INCREMENTAL-VDOM-LISTS]]; this card anchors that plan to `client-runtime/renderRev.js`. It is a one-export module with no imports on purpose: `datastore/store.js` writes the Symbol and `views/` reads it, and neither side may import the other.
