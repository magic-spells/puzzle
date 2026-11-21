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
  - DECISION-D193-SERVER-QUERIES
  - DOC-SPEC-DATA
verified_at: '2026-11-21T18:49:58.010Z'
verified_sha: 2166a6dbdbd6d290441b38f41a12245f62b12980
---

# adapter.js

The opt-in `@magic-spells/puzzle/adapter` capability ([[DECISION-D157-ADAPTER-SUBPATH]]).
Importing it has no side effects; passing the capability to `PuzzleApp` installs
the server verbs on `Store`/`PuzzleModel` (`loadOne`/`loadMany`, `save()`,
`delete()`, `store.request()`, `store.upsert()`, `store.invalidate()`,
`store.syncStatus()`), the fetch-function dispatch tier
([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]), the per-record write chain, the
D161 read state (dedup, negative cache, settle loop) and the server-query cache
([[DECISION-D193-SERVER-QUERIES]]). Apps that never pass it keep all of this out
of the bundle. Contract: [[DOC-SPEC-DATA]] §22, §58, §61, §68; behavior on
[[COMPONENT-ADAPTER]].
