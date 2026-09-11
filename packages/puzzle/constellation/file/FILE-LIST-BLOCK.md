---
name: persistent list blocks
status: built
path: client-runtime/views/listBlock.js
language: javascript
summary: 'Row state per key for one {#for} site: cached row vnodes, dirtiness rules, control collection.'
connections:
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
---

Source binding for the owning component cards. Behavioral intent stays in [[DECISION-D170-INCREMENTAL-VDOM-LISTS]] and [[COMPONENT-PUZZLE-VIEW]]; this card anchors that plan to `client-runtime/views/listBlock.js`.
