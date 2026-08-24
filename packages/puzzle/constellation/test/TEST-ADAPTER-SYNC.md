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
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Re-verified against current code and corrected: at least one claim on this card no longer
      matched the runtime, and the card was rewritten to state what the code actually does. Verified
      at this sha with the framework suite green at 1871 tests.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
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

Covers 4 files under `tests/`. The mock adapter used by app authors is proven
separately with the fixtures module.
