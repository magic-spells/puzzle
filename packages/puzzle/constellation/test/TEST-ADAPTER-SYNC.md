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
  - DOC-TESTING
  - FILE-ADAPTER
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Adapter server sync

Proves the opt-in adapter subpath — read path, write path, and request hook —
against a stubbed transport. Suites: `tests/adapter-*.test.js`; the D161
auto-fetch/settle loop has its own `auto-fetching-finds`, `settle-*` and
`collection-completeness` suites. Run with `npx vitest run tests/adapter-`.

- **Dispatch tier:** a per-verb fetch function on the model, the app-wide
  `adapter.defaults()`, and the endpoint-generated REST fallback; author-supplied
  transports, pagination, the bound adapter surface with its enhanced fetch, and
  config validation rejecting malformed adapter declarations.
- **Writes:** `save()` choosing POST vs PUT, validate-before-sync, non-OK
  responses leaving local state coherent, 2xx merge and revision reconciliation,
  first-save pk adoption, delete idempotency (a second `delete()` resolves with
  no request; two concurrent deletes issue one DELETE; `save()` after delete
  rejects without a POST), and the cross-verb write chain.
- **`beforeRequest`** (a public extension point, pinned tightly): fires for every
  verb with the right frozen context, may mutate in place or return a
  replacement, cannot change what the request fundamentally is, rejects the
  operation when it throws, and an AbortSignal it attaches actually aborts.

The author-facing mock adapter is proven with the fixtures module
([[TEST-PUBLIC-TESTING-SURFACE]]).
