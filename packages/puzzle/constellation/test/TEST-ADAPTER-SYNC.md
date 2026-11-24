---
name: Adapter server sync
kind: integration
status: verified
framework: vitest
connections:
  - FLOW-ADAPTER-SYNC
  - COMPONENT-STORE
  - COMPONENT-ADAPTER
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - DECISION-D132-CROSS-VERB-WRITE-CHAIN
  - DECISION-D137-LOAD-PK-GUARD
  - DECISION-D138-LOAD-REVISION-MERGE
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D161-AUTO-FETCHING-FINDS
  - DECISION-D193-SERVER-QUERIES
  - DOC-TESTING
  - FILE-ADAPTER
  - STATE-RECORD
verified_at: '2026-11-24T18:13:21.008Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# Adapter server sync

The opt-in `/adapter` capability (read path, write path, request hook, and the D161
auto-fetch settle loop) against a stubbed `fetch`. Run with
`npx vitest run tests/adapter- tests/auto-fetching tests/settle- tests/tracked- tests/tracking-overlap tests/collection-completeness tests/server-queries tests/paginated-posts-example`.

- **Dispatch** (`adapter-custom`, `adapter-defaults-local-models`): per-verb model
  function → app-wide `adapter.defaults()` → endpoint-generated REST; pagination, the
  bound adapter with its enhanced fetch, config validation. App defaults never make a
  local (endpoint-less) model fault.
- **Writes** (`adapter-write`, `adapter-removal-ordering`): POST vs PUT by `_synced`,
  validate-before-sync, non-OK responses leave local state coherent, revision-gated 2xx
  merge, first-save pk adoption, delete idempotency (a second `delete()` sends nothing;
  two concurrent deletes send one DELETE; `save()` after delete rejects with no POST), the
  cross-verb write chain. Record positions: [[STATE-RECORD]].
- **`beforeRequest`** (`adapter-request-hook`, a public extension point pinned tightly):
  fires for every verb with a frozen context, may mutate in place or return a
  replacement, cannot change what the request is, rejects the operation when it throws,
  and an AbortSignal it attaches really aborts.
- **Auto-fetching finds** (`auto-fetching-finds`, `collection-completeness`,
  `adapter-load-ordering`, `settle-loop`, `settle-window-supersession`,
  `settle-notification-delivery`, `tracked-read-attribution`, `tracked-load-warning`,
  `tracking-overlap`): fetch batches and dirty re-passes share the ten-round cap, and
  exhaustion rejects with a view-specific diagnostic and commits no partial model; only
  the run that owns the settle window clears its dirty flag; an automatic fault racing an
  explicit `loadOne`; a foreign read during a suspension is attributed correctly; a
  prepared refresh keeps its own tracking scope.
- **Server queries** (`server-queries`, [[DECISION-D193-SERVER-QUERIES]]): a query read
  faults once with the serialized URL, keeps pages apart and in server order, carries a
  frozen non-enumerable `meta`, and dedupes canonical spellings and two views; untracked
  reads are local; bad queries throw; explicit `loadMany` fills the entry; the LRU
  evicts at 200. `invalidate` in all three forms refetches only what a view reads, keeps
  a pre-invalidate response stale, removes a record whose refetch 404s, and retries after
  a failed refetch. `syncStatus` and the write promise flip through queued writes; the
  read-state round-trip carries queries; the fixtures mock paginates by page and cursor. `paginated-posts-example` boots the compiled example over its own fixtures: page links, a failed and a successful publish, and the comment cursor.
- **Isolation** (`adapter-realm-isolation`): installing the adapter in one app does not
  leak into a later adapter-less app.

The author-facing mock adapter is proven in [[TEST-PUBLIC-TESTING-SURFACE]], not here.
