---
name: 'D91 — beforeRequest: one synchronous hook on every adapter fetch'
status: verified
connections:
  - COMPONENT-STORE
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D81-STATIC-PAGES-MODE
  - DOC-SPEC
  - DOC-DATASTORE
  - FILE-ADAPTER
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/datastore/adapter.js
  - client-runtime/app.js
---

# D91 — `beforeRequest`: one synchronous hook on every adapter fetch

Every adapter fetch goes through one private `_fetch(url, init, context)`
(installed by `@magic-spells/puzzle/adapter`, `datastore/adapter.js`). An
optional `beforeRequest(init, { type, method, url })` on the app config shapes
`init` before it goes out — auth headers, `credentials`, an `AbortSignal` for the
whole adapter surface at once.

## Decision

- `_fetch` is the only path by which generated transports, D158's enhanced
  fetch and `store.request()` reach the network. Author code calling global
  `fetch` bypasses it. (`_` prefix: the datastore uses `_` helpers uniformly.)
- Reads send an explicit `{ method: 'GET' }` init, so a hook never meets a
  missing init.
- **Synchronous.** The hook may mutate `init` or return a replacement; a truthy
  object return wins. A replacement is shallow-copied before re-stamping, so
  frozen objects and getter-only fields are fine.
- **`method` and `body` are re-stamped from the original after the hook.** The
  write path captures `requestKey = record[pk]` before the await and reconciles
  against it (D50); a hook that changed method or body would break identity
  checks, pk adoption and `_synced`. The URL is a separate argument, out of
  reach. A hook changes *how* a request is sent, never *what* it is.
- The context argument is frozen. A throwing hook is not caught — it rejects the
  calling verb rather than ship an unauthenticated request.
- The Store keeps the hook only if it's a function (null otherwise), so the
  no-hook path is one truthiness check.
- The prerender store carries the hook, so a build-time `beforeMount` seed hits
  an authenticated API too. **`output: 'static'` cannot:** page-entry options
  are serialized into a Go-generated module and a function doesn't survive
  that; closing it would need the entry to import the value from a real module.
- A bare replacement object drops original headers (`return {}` loses
  `Content-Type`); the idiom is `return { ...init, headers: … }`.

## Alternatives

- **Async hook** (inline token refresh) — rejected for now: an `await` before
  every call and no coalescing story against D50's save chain; widening later is
  easy.
- **Letting the hook rewrite method/URL/body** — breaks D50 reconciliation.
- **Merging the return into the original** — makes removing a header
  impossible.
- **A store-wide `fetch` replacement option** — rejected (D158's per-store
  enhanced primitive is a different thing).
- **Per-model hooks** — auth is cross-cutting; can layer on later.
