---
name: "D21 — Server data in v1: explicit load methods reading the model's adapter declaration"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-DATASTORE
  - DOC-SPEC-DATA
---

# D21 — Server data in v1: explicit load methods reading the model's adapter declaration

Settled. In v1 the model file is the single source of truth for schema and server location, and the store consumes the model's `adapter` declaration on the read path only via two explicit load methods.

## Context
The model file is the single source of truth for both schema and server location:
`static adapter = adapter({ endpoint: '/api/posts' })`, with `adapter` imported
from `@magic-spells/puzzle/adapter`. v1 needs a read path that consumes that
declaration without committing to a full ORM-style sync engine.

## Decision
**v1 consumes the declaration on the read path** via explicit store methods:

- `store.loadAll(type)` — GET `apiURL + adapter.endpoint`, bulk-`createRecord` the results (existing records with matching primary keys are updated, not duplicated).
- `store.loadOne(type, id)` — GET `apiURL + endpoint + '/' + id`, upsert one record.

Both are installed by the adapter factory and return promises (awaitable from
async `data()` or app startup). Loaded records flow through the normal
subscription pipeline — subscribed views re-render when data arrives. `apiURL`
from the PuzzleApp config ([[DOC-SPEC]] §2) is the base; a model with no
`adapter` makes `loadAll`/`loadOne` a rejected promise with a clear message.

## Consequences
**Still deferred (post-v1):** transparent query fault-in (`findMany` fetching on miss), automatic write sync (`update()`/`destroy()` POSTing back), custom adapter methods, caching/dedup policy. Manual `fetch` in async `data()` remains fully supported for anything beyond the read path.

The server read path is opt-in through [[DECISION-D157-ADAPTER-SUBPATH]]; an app
that never calls the factory has no adapter verbs on its Store prototype.
