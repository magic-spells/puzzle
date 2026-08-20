---
name: 'D21 — Server data: tracked finds fault in through the model''s adapter declaration'
status: building
verified_at: '2026-07-15T08:17:25.000Z'
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
---

# D21 — Server data: tracked finds fault in through the model's adapter declaration

The model file is the single source of truth for schema and server location
(`static adapter = { endpoint: '/api/posts' }`), and the store consumes that
declaration on the read path **transparently**: a `findOne`/`findMany` miss
inside a tracked `data()` evaluation faults the missing data in through the
model's read verbs, and the view commits once the pass settles
([[DECISION-D161-AUTO-FETCHING-FINDS]] owns the loop, dedup, and cache
policy).

## Context

The app passes the `adapter` capability from `@magic-spells/puzzle/adapter`
once to `PuzzleApp` ([[DECISION-D157-ADAPTER-SUBPATH]]); a store without it
has no server read path at all. The read path had to consume the model's
declaration without an ORM-style sync engine, without loading code leaking
into views, and without a second fetching surface for developers to learn.

## Decision

- **Tracked reads are the read path.** `store.findOne(type, id)` /
  `store.findMany(type, { filter })` return local data synchronously; a miss
  during a tracked `data()` run additionally queues the model's read
  transport when D158 dispatch resolves one. Loaded records flow through the
  normal subscription pipeline. `apiURL` ([[DOC-SPEC]] §2) is the base for
  generated transports.
- **Explicit imperative loads remain, as escape hatches:**
  `store.loadMany(type, options?)` (collection transport + bulk upsert,
  pagination options forwarded) and `store.loadOne(type, id)` (one record,
  bypasses the negative cache — the force-refresh idiom). Both return
  promises, both stay off the taught beginner surface, and both warn in dev
  when called inside a tracked run.
- A model with no resolvable read verb makes the tracked path pure-local and
  the explicit loads a rejected promise with a clear message.

## Alternatives rejected

- **Explicit-only loads** (v1 through 0.6.0's `loadAll`/`loadOne` as the
  entire read path): the only workable pattern was eager whole-collection
  seeding after `mount()`, because a load awaited inside `data()` re-triggers
  itself through its own upsert. Per-route on-demand fetching effectively
  didn't exist, and the loop footgun had to be documented instead of
  designed away.
- A full ORM-style sync engine — far more surface than the framework needs.

## Consequences

Views fetch by reading. The eager-seed idiom is retired; manual `fetch` in
async `data()` remains fully supported. Write-through stayed with D50's
explicit verbs; transport authorship is [[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]].
