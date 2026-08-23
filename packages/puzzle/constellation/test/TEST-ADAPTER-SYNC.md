---
name: Adapter server sync
kind: integration
status: verified
framework: vitest
connections:
  - FLOW-ADAPTER-SYNC
  - COMPONENT-STORE
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D125-SAVE-RECONCILE-REVISION
  - DECISION-D132-CROSS-VERB-WRITE-CHAIN
  - DECISION-D137-LOAD-PK-GUARD
  - DECISION-D138-LOAD-REVISION-MERGE
  - DECISION-D157-ADAPTER-SUBPATH
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - FEATURE-ADAPTER-WRITE-SYNC
  - FEATURE-DELETE-IDEMPOTENCY
  - DOC-TESTING
  - FILE-ADAPTER
verified_at: '2026-08-23T19:55:49.676Z'
verified_sha: 95a69be36bf38f6d1c43fb9caa9056e2530c4ceb
---

# Adapter server sync

Proves the opt-in adapter subpath: the read path, the write path, and the
request hook, all against a stubbed transport.

Dialect coverage runs the whole dispatch tier — a per-verb fetch function on the
model, the app-wide `adapter.defaults()`, and the endpoint-generated REST
fallback — plus author-supplied transports, pagination, the bound adapter
surface with its enhanced fetch, and config validation rejecting malformed
adapter declarations.

Write coverage: `save()` choosing POST versus PUT, validating before syncing,
non-OK responses leaving local state coherent, 2xx response merge and revision
reconciliation, the first-save primary-key adoption, delete idempotency, and the
cross-verb write chain.

`beforeRequest` is pinned tightly because it is a public extension point: it
fires for every verb with the right context, may mutate in place or return a
replacement, cannot change what the request fundamentally is, receives a frozen
context, rejects the operation when it throws, and an AbortSignal it attaches
actually aborts.

Covers 3 files under `tests/`. The mock adapter used by app authors is proven
separately with the fixtures module.
