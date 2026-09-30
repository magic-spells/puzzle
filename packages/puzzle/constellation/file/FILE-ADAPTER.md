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
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
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
