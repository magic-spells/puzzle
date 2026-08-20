---
name: v1.76 — Auto-fetching finds (tracked fault-in + settle loop)
status: building
release: RELEASE-V0-7-0
change: feature
connections:
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - RELEASE-V0-7-0
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - COMPONENT-PUZZLE-VIEW
  - COMPONENT-SSG
  - COMPONENT-DEVSTATE
  - DOC-SPEC-DATA
  - DOC-DATASTORE
---

# v1.76 — Auto-fetching finds

Tracked `findOne`/`findMany` fetch what the store is missing; `data()` needs
zero loading code, and a committed `null` means "does not exist," never "still
loading." Driven by [[DECISION-D161-AUTO-FETCHING-FINDS]]; contract in
[[DOC-SPEC-DATA]] §61.

## Intent

Close the framework's real-server gap: before this, the only shipped pattern
was eager whole-collection seeding after `mount()`, because a load awaited
inside `data()` looped through its own upsert. On-demand per-route data goes
from documented footgun to the default behavior of the verbs people already
call, without raising the taught surface — one rule: server data comes from
`data()`.

## Scope

**In (shipped):**
- The settle loop (PuzzleView, installed by the adapter capability): a pass
  whose tracked misses queued deduped fetches is not committed; the batch is
  awaited and `data()` re-runs; the first warm pass commits its model and
  subscriptions. Ten rounds throw naming the view. Store notifications
  mid-settle coalesce into one more pass; D146 prepared runs park the final
  pass's reconcile.
- Adapter-owned read state per Store: in-flight dedup by `recordKey`, a
  1000-entry negative LRU for normalized 404s (never persisted), the
  collection-complete type set (no-options collection success only, empty
  counts), and every invalidation path. Explicit `loadOne` bypasses the
  negative cache (force refresh); confirmed `delete()` records absence.
- `loadAll` → `loadMany` (One/Many everywhere) with production-loud guards at
  every old-spelling site; dev warning for explicit loads inside tracked runs.
- Generated read failures normalize to `PuzzleAdapterError`; `loadOne`
  responses must match the requested id (before-mutation reject).
- Relationships resolve through local-only lookups — same subscription keys,
  never fault (D49 amended).
- Prerender faults at build time through the same loop; static pages carry the
  read-state island (`data-puzzle-static-read`) so `mountStatic` repeats
  nothing; hybrid transfers nothing; the dev HMR snapshot carries read state.
- No-adapter apps ship none of it: settle executor and caches live in the
  `/adapter` module (+177 B gzip core seam; hello-world 19.8 KB, todos
  22.9 KB).

**Out (deferred in D161):** server-side query/pagination keys on `findMany`,
TTL/`reload(type)` invalidation, request cancellation, relationship
auto-fetch, `{#await}` templates, a separate `load()` view hook.

## Outcome

Built on the 0.7.0 line. Runtime: store.js fault hook +
`_findOneLocal`/`_findManyLocal`, adapter.js read state + rename + guards +
`serializeReadState`/`hydrateReadState` (via the capabilities.js relay),
PuzzleView `_settleData` installed by `installAdapter()`, ssg/static read
island, devstate carry. Examples migrated off eager seeding (blog is the
canonical auto-fetch app; its static-file "server" demonstrates the custom
`loadOne` + 404-Response not-found convention). Covered by
`tests/auto-fetching-finds.test.js`, `tests/settle-loop.test.js`, and the
extended static/HMR/store suites.
