---
name: Adapter server sync
status: verified
triggers:
  - kind: manual
connections:
  - STATE-RECORD
  - FLOW-REACTIVITY
  - COMPONENT-ADAPTER
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-FIXTURES
  - FILE-ADAPTER
  - DOC-SPEC-DATA
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
verified_at: '2026-11-01T19:23:56.488Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Adapter server sync

The opt-in server path ([[COMPONENT-ADAPTER]] owns the module). It ends by re-entering [[FLOW-REACTIVITY]]: every server verb finishes with an ordinary store notification. **A transport owns the HTTP conversation and nothing else** — validation, shape guards, identity, pk adoption, provenance, write ordering, notification and persistence are framework-owned and identical for generated REST and author functions.

1. The app passes the capability once in `PuzzleApp` config — bare `adapter` or `adapter.defaults({...verbs})` ([[DECISION-D157-ADAPTER-SUBPATH]]). Installing grafts the server surface onto Store/PuzzleModel/PuzzleView before any Store exists (idempotent, realm-wide).
2. A verb is invoked. `loadMany`, `loadOne` and `request` dispatch at once — explicitly, or (`loadOne`/`loadMany`) from a tracked find, which first checks eligibility, in-flight dedup, the negative cache and the LOADED/EXHAUSTIVE sets ([[DECISION-D161-AUTO-FETCHING-FINDS]]). `upsert` applies data with no request. `save` and `delete` enqueue on the record's single cross-verb write chain ([[DECISION-D132-CROSS-VERB-WRITE-CHAIN]]).
3. At the chain's front a write re-reads the record and pre-flights: a save of a removed record rejects (no revival); a save validates the FULL record (`PuzzleValidationError` = nothing sent); a delete of an already-removed record resolves; a delete of a never-synced record removes locally and sends nothing.
4. Dispatch: model function → app `defaults()` function → endpoint-generated REST ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]). No tier is a per-verb error naming the signature.
5. **Capture the reconciliation boundary before awaiting**: the key the record is indexed under, its mutation revision ([[DECISION-D125-SAVE-RECONCILE-REVISION]]), and a dispatch generation from the read counter.
6. The transport calls its pre-bound enhanced fetch (platform-shaped; no URL prefixing, no JSON). That funnels through `beforeRequest(init, context)` — sync; may mutate or replace the init; method and body are re-stamped; a throw rejects the verb — and then `_network` ([[DECISION-D91-ADAPTER-REQUEST-HOOK]]). `/fixtures` replaces `_network`, so mocks run after the hook ([[DECISION-D98-FIXTURES-MODULE-FLAG]]).
7. Normalize: a `Response` is status-checked and its body read once (JSON, else text, empty → `undefined`); data an author returns directly passes through. Non-OK throws `PuzzleAdapterError`.
8. **Guard the whole payload before any mutation**: loads need objects carrying the pk on every element, all-or-nothing ([[DECISION-D137-LOAD-PK-GUARD]]); on the fault path a `loadOne` pk must match the requested id; writes need a pk-bearing object or a nullish no-echo.
9. Re-check identity against step 5's key; if the record there changed, skip every local effect and resolve with the detached record.
10. Reconcile ([[STATE-RECORD]]): revision-gated merge, pk adoption on a first save, `_synced`, or `removeRecord` on a delete ack. A save stamps its generation on the record (`Math.max`), so a read dispatched BEFORE the save is dropped for that record and cannot revert the acknowledged body ([[DECISION-D138-LOAD-REVISION-MERGE]]); save reconciliation never routes through `_upsert`. Read state updates alongside: a landed identity clears its negative entry, a 404 records one, a no-options collection success marks the type loaded, a confirmed delete records absence.
11. Notify record and collection keys and flag persistence; the batched `flush()` delivers once and writes storage once. A view mid-settle folds the notification into one more pass.

## Load-bearing ordering

- Validate before the network; capture the key before the await and compare after — which is also why the hook may not change method or body.
- Serialize per record ACROSS verbs: a delete queued behind a first save builds its request from the adopted key; a link's rejection is swallowed for chaining only, so each caller sees its own outcome.

## Gotchas

- 404-tolerance on delete belongs to the generated transport; an author delete returning a 404 `Response` rejects.
- A rejected write leaves `_synced` unchanged; a create the server applied but acknowledged with an unusable body will be re-created on the next `save()`. A server that doesn't echo the record needs a create/update function that returns nothing.
- Global `fetch` bypasses the hook and the mock seam — author functions must use the fetch they are handed.
- `upsert()`/`request()` are imperative "apply this server truth now" verbs — not revision-gated and outside the write chain.
- Only a 404 means absence on the fault path — a custom read signals not-found with `new Response(null, { status: 404 })`.
