---
name: "D21 — Server data in v1: explicit load methods reading the model's adapter declaration"
status: verified
verified_at: '2026-07-15T08:17:25.000Z'
connections:
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-DATASTORE
---

# D21 — Server data in v1: explicit load methods reading the model's adapter declaration

Settled. In v1 the model file is the single source of truth for schema and server location, and the store consumes the model's `adapter` declaration on the read path only via two explicit load methods.

## Context
The model file is the single source of truth for both schema and server location: `static adapter = { endpoint: '/api/posts' }`. v1 needs a read path that consumes that declaration without committing to a full ORM-style sync engine. This restores the `adapter` block to the canonical `todo.js` and matches the original `app.js` design, which called `store.loadAll('todo')` at startup.

## Decision
**v1 consumes the declaration on the read path** via explicit store methods:

- `store.loadAll(type)` — GET `apiURL + adapter.endpoint`, bulk-`createRecord` the results (existing records with matching primary keys are updated, not duplicated).
- `store.loadOne(type, id)` — GET `apiURL + endpoint + '/' + id`, upsert one record.

Both return promises (awaitable from async `data()` or app startup), and loaded records flow through the normal subscription pipeline — subscribed views re-render when data arrives. `apiURL` from the PuzzleApp config ([[DOC-SPEC]] §2) is the base; a model with no `adapter` makes `loadAll`/`loadOne` a rejected promise with a clear message.

## Consequences
**Still deferred (post-v1):** transparent query fault-in (`findMany` fetching on miss), automatic write sync (`update()`/`destroy()` POSTing back), custom adapter methods, caching/dedup policy. Manual `fetch` in async `data()` remains fully supported for anything beyond the read path.

This restores the `adapter` block to the canonical `todo.js` and matches the original `app.js` design, which called `store.loadAll('todo')` at startup.
