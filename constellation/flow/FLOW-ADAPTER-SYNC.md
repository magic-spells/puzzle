---
name: Adapter server sync
status: built
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
  - FEATURE-ADAPTER-WRITE-SYNC
  - FEATURE-STORE-PUBLIC-UPSERT
  - FILE-ADAPTER
---

# Adapter server sync

The opt-in server path. [[FLOW-REACTIVITY]] owns the local tracking loop; this
flow ends by re-entering it, because the last thing every server verb does is an
ordinary store notification — a component that queried the loaded records
re-runs `data()` with no server-specific wiring anywhere in it.

The division of labour is the whole design: **a transport owns the HTTP
conversation and nothing else.** Validation, shape guards, identity,
primary-key adoption, provenance, write ordering, notification, and persistence
are framework-owned, and therefore behave identically whether the bytes were
moved by an endpoint-generated REST default or by a function the author wrote.

1. The app passes the capability from `@magic-spells/puzzle/adapter` **once** in
   its `PuzzleApp` config — the bare `adapter`, or `adapter.defaults({ ...verbs })`
   to declare an app-wide dialect ([[DECISION-D157-ADAPTER-SUBPATH]]).
   - a truthy value that is not the capability is a construction-time error
     naming the import
   - a model declaring `static adapter` while no capability was passed warns in
     development with the model name and the fix
2. Installing grafts the server surface onto `Store` and `PuzzleModel`
   prototypes before any Store is constructed. It is idempotent, and an app that
   never opts in ships none of it — no verbs, no write chain, no adapter error
   class.
3. A verb is invoked. Reads (`loadAll`, `loadOne`, `upsert`, `request`) run
   straight away; writes (`save`, `delete`) enqueue on that record's single
   write chain and wait ([[DECISION-D132-CROSS-VERB-WRITE-CHAIN]]).
4. At the front of the chain the write re-reads the record, then pre-flights.
   - a save whose record was removed while it waited rejects with the same
     message `save()` gives at call time — no write may revive a discarded row
   - a save validates the **full** record first; invalid rejects with
     `PuzzleValidationError` and no request is made
   - a delete of a never-synced record removes locally and sends nothing
5. Transport dispatch resolves in three tiers: the model's own function, then
   the app `adapter.defaults()` function, then the endpoint-generated REST
   default ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]). Nothing at any tier is a
   per-verb error naming the signature to add.
6. The Store captures the reconciliation boundary **before** awaiting: the map
   key this record is currently indexed under, and its local mutation revision
   ([[DECISION-D125-SAVE-RECONCILE-REVISION]]).
7. The transport runs, calling the enhanced fetch pre-bound to it. It is
   platform-shaped — URL plus init in, `Response` out — with no URL prefixing
   and no automatic JSON.
8. That fetch funnels through the one seam: `beforeRequest(init, context)` runs
   synchronously and may mutate or replace the init, method and body are then
   re-stamped from the original, and `_network` makes the call
   ([[DECISION-D91-ADAPTER-REQUEST-HOOK]]).
   - a hook that throws is not caught — an auth failure must reject the verb,
     not ship an unauthenticated request
   - `/fixtures` replaces `_network`, so mocking runs strictly *after* the hook
     ([[DECISION-D98-FIXTURES-MODULE-FLAG]])
9. The result is normalized. A returned `Response` is status-checked and its
   body read exactly once — parsed JSON when it parses, raw text when it does
   not, `undefined` when empty; parsed data an author returned directly passes
   through untouched.
10. Shape and key guards run **before any mutation**: loads require object
    shapes carrying the primary key on every element, checked up front and
    all-or-nothing ([[DECISION-D137-LOAD-PK-GUARD]]); writes require a pk-bearing
    object or a nullish no-echo.
11. Identity is re-checked against the key captured in step 6. If this is no
    longer the indexed record there, every local effect is skipped and the verb
    resolves with the detached record.
12. Reconciliation applies: revision-gated merge, primary-key adoption on a
    first save, `_synced` set, or `removeRecord` on a delete ack — see
    [[STATE-RECORD]] for what each does to the record's position.
13. The Store notifies the affected record and collection keys and flags
    persistence; the batched `flush()` delivers subscribers once and writes the
    storage snapshot once.

## Ordering that is load-bearing

- **Validate before the network.** An invalid record must never reach the
  server, and the caller must be able to tell a rejected write from a failed
  one: `PuzzleValidationError` means nothing was sent.
- **Capture the key before the await, compare after.** Everything downstream —
  pk adoption, the `_synced` flip, the delete's removal — reconciles against
  exactly that key. It is also why the request hook may not rewrite method or
  body: a hook that flipped POST to PUT would silently invalidate the check.
- **Guard the whole payload before touching anything.** A load validates every
  element up front so a bad entry mid-array cannot half-apply the response.
- **Serialize per record, across verbs.** Save and delete mutate the same server
  row and the same map entry, so ordering them separately is not enough. A
  delete queued behind a first save builds its request from the *adopted* server
  key; a chained link's rejection is swallowed for chaining only, so every
  caller observes its own outcome and nothing inherits a neighbour's failure.

## Gotchas

- **The error type on a failed read depends on which tier served it.** A
  generated read rejects with a plain `Error` carrying the status; an author
  transport that returns a non-OK `Response` rejects with `PuzzleAdapterError`.
- **404-tolerance on delete belongs to the generated transport**, not the
  framework. An author's delete that returns a 404 `Response` rejects; to keep
  the idempotent behaviour, handle it inside the function.
- **A write that rejects leaves `_synced` false.** On a create that the server
  actually applied but acknowledged with a body Puzzle refuses, the row exists
  remotely while the next `save()` dispatches create again and duplicates it. A
  server that acknowledges without echoing the record needs a create/update
  function that returns nothing.
- **Global fetch is legal and bypasses everything in step 8** — the hook and the
  mock seam both. Author functions must use the fetch they are handed to stay
  inside the pipeline.
- **`upsert()` is imperative, not revision-gated.** Loads respect edits made
  while they were in flight ([[DECISION-D138-LOAD-REVISION-MERGE]]); `upsert()`
  and `request()` deliberately do not — they are the explicit
  "apply this server truth now" verbs for custom-action responses.
- **`store.adapter(type)` is the only way to call a custom transport.** The
  framework never invokes one; the bound view exists so an author's function
  gets the enhanced fetch, and its result is usually handed to `upsert()`.
- **Configured dialects are per Store**, so two apps on one page can carry
  different app defaults.
