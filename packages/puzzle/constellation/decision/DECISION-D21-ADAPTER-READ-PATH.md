---
name: 'D21 — Server data: tracked finds fault in through the model''s adapter declaration'
status: verified
verified_at: '2026-08-24T18:51:34.759Z'
connections:
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - DOC-DATASTORE
  - DOC-SPEC-DATA
  - DOC-SPEC
  - FILE-ADAPTER
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

# D21 — Server data: tracked finds fault in through the model's adapter declaration

## Decision
The model file is the single source of truth for schema and server location (`static adapter = { endpoint: '/api/posts' }`). The app passes the `adapter` capability from `@magic-spells/puzzle/adapter` to `PuzzleApp` once ([[DECISION-D157-ADAPTER-SUBPATH]]); without it the store has no server read path.

- **Tracked reads are the read path.** `store.findOne(type, id)` / `store.findMany(type, { filter })` return local data synchronously. An unsatisfied read inside a tracked `data()` run — a `findOne` miss, or a `findMany` on a type not yet collection-complete — also queues the model's read transport, and the view commits once the pass settles. [[DECISION-D161-AUTO-FETCHING-FINDS]] owns the loop, dedup and cache policy; transport dispatch is [[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]. `apiURL` is the base for generated transports.
- **Explicit loads are escape hatches.** `store.loadMany(type, options?)` (bulk upsert; only a no-options call marks the collection complete) and `store.loadOne(type, id)` (bypasses the negative cache — the force-refresh idiom). Both return promises, stay off the beginner surface, and warn in dev inside a tracked run.
- **An explicit `loadOne` may resolve a non-primary key** (`loadOne('post', 'my-slug')` upserts what came back). The response-identity guard that drops a record whose key differs from the request applies only to the automatic fault path, where a mismatch would re-request the still-missing id every round until the cap.
- **Fault eligibility is narrower than dispatch.** A model faults only on its **own** declared verb or `endpoint`, never on the app-wide dialect tier alone, so `adapter.defaults()` does not make every local-only model fetchable. With no verb at all, explicit loads reject with a clear message.

Writes stay explicit verbs ([[DECISION-D50-ADAPTER-WRITE-SYNC]]). Manual `fetch` in async `data()` remains supported.

## Alternatives rejected
- Explicit-only loads (the whole read path through 0.6.0) — a load awaited inside `data()` re-triggers itself through its own upsert, so the only workable pattern was eager whole-collection seeding after `mount()`.
- A full ORM-style sync engine — far more surface than the framework needs.
