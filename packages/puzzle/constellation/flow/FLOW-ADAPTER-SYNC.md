---
name: Adapter server sync
status: verified
triggers:
  - kind: manual
connections:
  - STATE-RECORD
  - FLOW-REACTIVITY
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - FILE-STORE
  - FILE-PUZZLE-MODEL
  - DOC-SPEC-DATA
  - DOC-DATASTORE
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D48-SCHEMA-VALIDATION
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - DECISION-D132-CROSS-VERB-WRITE-CHAIN
  - DECISION-D137-LOAD-PK-GUARD
  - DECISION-D138-LOAD-REVISION-MERGE
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D161-AUTO-FETCHING-FINDS
  - FILE-ADAPTER
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Adapter server sync

The opt-in server path ([[COMPONENT-ADAPTER]] owns the module). It ends by re-entering
[[FLOW-REACTIVITY]]: every server verb finishes with an ordinary store notification.
**A transport owns the HTTP conversation and nothing else** — validation, shape guards,
identity, pk adoption, provenance, write ordering, notification and persistence are
framework-owned and identical for generated REST and author functions.

1. The app passes the capability once in `PuzzleApp` config — bare `adapter` or
   `adapter.defaults({...verbs})` ([[DECISION-D157-ADAPTER-SUBPATH]]). A non-capability
   value is a construction error; a model with `static adapter` but no capability warns.
2. Installing grafts the server surface onto Store/PuzzleModel/PuzzleView before any
   Store exists (idempotent, realm-wide).
3. A verb is invoked. Reads (`loadMany`, `loadOne`, `upsert`, `request`) run at once —
   explicitly, or from a D161 tracked fault, which first checks in-flight dedup, the
   negative cache and collection completeness ([[DECISION-D161-AUTO-FETCHING-FINDS]]).
   Writes (`save`, `delete`) enqueue on the record's single cross-verb write chain
   ([[DECISION-D132-CROSS-VERB-WRITE-CHAIN]]).
4. At the chain's front a write re-reads the record and pre-flights: a save of a record
   removed while waiting rejects (no revival); a save validates the FULL record
   (`PuzzleValidationError` = nothing was sent); a delete of a never-synced record removes
   locally and sends nothing.
5. Dispatch: model function → app `defaults()` function → endpoint-generated REST
   ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]). No tier is a per-verb error naming the
   signature — except on the fault path, where it just means the find stays local.
6. **Capture the reconciliation boundary before awaiting**: the key the record is indexed
   under, its mutation revision ([[DECISION-D125-SAVE-RECONCILE-REVISION]]) and a dispatch
   generation from the read counter.
7. The transport calls its pre-bound enhanced fetch (platform-shaped; no URL prefixing, no
   JSON). It funnels through `beforeRequest(init, context)` (sync; may mutate/replace the
   init; method and body are re-stamped; a throw is NOT caught — an auth failure must reject
   the verb) and then `_network` ([[DECISION-D91-ADAPTER-REQUEST-HOOK]]). `/fixtures`
   replaces `_network`, so mocks run after the hook ([[DECISION-D98-FIXTURES-MODULE-FLAG]]).
8. Normalize: a `Response` is status-checked and its body read once (JSON, else text, empty
   → `undefined`); data an author returns directly passes through. Non-OK throws
   `PuzzleAdapterError`.
9. **Guard the whole payload before any mutation**: loads need object shapes carrying the
   pk on every element, all-or-nothing ([[DECISION-D137-LOAD-PK-GUARD]]); on the fault path
   a `loadOne` pk must match the requested id; writes need a pk-bearing object or a nullish
   no-echo.
10. Re-check identity against step 6's key; if the record there changed, skip every local
    effect and resolve with the detached record.
11. Reconcile ([[STATE-RECORD]]): revision-gated merge, pk adoption on a first save,
    `_synced`, or `removeRecord` on a delete ack. A save stamps its generation on the record
    (`Math.max`), so a read dispatched BEFORE the save is dropped for that record and can't
    revert the acknowledged body ([[DECISION-D138-LOAD-REVISION-MERGE]]); save
    reconciliation never routes through `_upsert`. D161 read state updates alongside
    (landed identity clears its negative entry, a normalized 404 records one, a no-options
    collection success marks the type loaded, a confirmed delete records absence).
12. Notify record and collection keys and flag persistence; the batched `flush()` delivers
    once and writes storage once. A view mid-settle folds it into one more pass.

## Load-bearing ordering

- Validate before the network; capture the key before the await and compare after — which
  is also why the hook may not change method or body.
- Serialize per record ACROSS verbs: a delete queued behind a first save builds its request
  from the adopted key; a chained link's rejection is swallowed for chaining only, so each
  caller sees its own outcome.

## Gotchas

- 404-tolerance on delete belongs to the generated transport; an author delete returning a
  404 `Response` rejects.
- A rejected write leaves `_synced` false; a create the server applied but acknowledged
  with a refused body will be re-created on the next `save()`. A server that doesn't echo
  the record needs a create/update function that returns nothing.
- Global `fetch` bypasses the hook and the mock seam — author functions must use the fetch
  they are handed.
- `upsert()`/`request()` are imperative "apply this server truth now" verbs — not
  revision-gated and outside the save ordering.
- `store.adapter(type)` is the only way to call a custom transport; its result is usually
  handed to `upsert()`.
- Only a normalized 404 means absence on the fault path — signal not-found with
  `new Response(null, { status: 404 })`.
