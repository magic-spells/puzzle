---
name: server adapter runtime
status: verified
path: client-runtime/datastore/adapter.js
language: javascript
summary: >-
  The opt-in server sync runtime published as ./adapter: the capability, the installed
  Store/PuzzleModel verbs, and PuzzleAdapterError.
connections:
  - COMPONENT-ADAPTER
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DOC-SPEC-DATA
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# adapter.js

The opt-in `@magic-spells/puzzle/adapter` capability ([[DECISION-D157-ADAPTER-SUBPATH]]).
Importing it has no side effects; passing the capability to `PuzzleApp` installs
the server verbs on `Store`/`PuzzleModel` (`loadOne`/`loadMany`, `save()`,
`delete()`, `store.request()`, `store.upsert()`), the fetch-function dispatch tier
([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]), the per-record write chain, and the
D161 read state (dedup, negative cache, settle loop). Apps that never pass it
keep all of this out of the bundle. Contract: [[DOC-SPEC-DATA]] §22, §58, §61;
behavior on [[COMPONENT-ADAPTER]].
