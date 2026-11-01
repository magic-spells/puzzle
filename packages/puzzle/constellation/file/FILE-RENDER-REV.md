---
name: record render revision symbol
status: verified
path: client-runtime/renderRev.js
language: javascript
summary: The RENDER_REV Symbol the store stamps on records and the view layer compares against.
connections:
  - COMPONENT-STORE
  - COMPONENT-VIEW-MANAGER
  - COMPONENT-PUZZLE-VIEW
  - DECISION-D170-INCREMENTAL-VDOM-LISTS
verified_at: '2026-11-01T19:25:05.957Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# renderRev.js

The `RENDER_REV` Symbol alone ([[DECISION-D170-INCREMENTAL-VDOM-LISTS]]). `datastore/store.js` stamps a record's last notification sequence onto it; `views/listBlock.js`, `views/viewManager.js` (`propsEqual`) and `views/PuzzleView.js` compare against it, so a record prop refreshes a child on that record's own in-place mutations.

- **No imports, on purpose.** The store and the views sit on opposite sides of the model/view seam, and neither may import the other.
- **Not public API.** `index.js` does not export it. It is separate from the `MUTATION_REVISIONS` counter (D125), which counts local edits for save reconciliation.
