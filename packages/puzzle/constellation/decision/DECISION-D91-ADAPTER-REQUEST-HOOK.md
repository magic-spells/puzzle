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
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/datastore/adapter.js
  - client-runtime/app.js
---

# D91 — `beforeRequest`: one synchronous hook on every adapter fetch

Every adapter fetch goes through one private `_fetch(url, init, context)`,
installed by the opt-in `@magic-spells/puzzle/adapter` capability
(`datastore/adapter.js`). An optional `beforeRequest(init, { type, method, url })`
on the app config shapes `init` before it goes out — auth headers,
`credentials`, an `AbortSignal` — for the whole adapter surface at once.

## Decision

- `_fetch` is the only path by which generated transports, D158's enhanced
  fetch and `store.request()` reach the network. It hands off to `_network`,
  the seam fixtures replace (D98). Author code calling global `fetch` bypasses
  both.
- Reads send an explicit `{ method: 'GET' }` init, so a hook never meets a
  missing init.
- **Synchronous.** The hook may mutate `init` or return a replacement; a truthy
  object return wins. A replacement is shallow-copied before re-stamping, so
  frozen objects and getter-only fields are fine.
- **`method` and `body` are re-stamped from the original after the hook.** The
  write path captures `requestKey = record[pk]` before the await and reconciles
  against it (D50); a hook that changed method or body would break identity
  checks, pk adoption and the synced flag. The URL is a separate argument, out
  of reach. A hook changes *how* a request is sent, never *what* it is.
- The context argument is frozen. A throwing hook is not caught — it rejects the
  calling verb rather than ship an unauthenticated request.
- The Store keeps the hook only if it's a function (null otherwise), so the
  no-hook path is one truthiness check.
- The hybrid prerender store carries the hook, so a build-time `beforeMount`
  seed hits an authenticated API too. **`output: 'static'` page modules do
  not:** page-entry options are serialized into a Go-generated module and a
  function doesn't survive that.

## Gotchas

A bare replacement object drops the original headers (`return {}` loses
`Content-Type`); the idiom is `return { ...init, headers: … }`.

## Alternatives rejected

- **Async hook** (inline token refresh) — an `await` before every call and no
  coalescing story against D50's save chain; widening later is easy.
- **Letting the hook rewrite method/URL/body** — breaks D50 reconciliation.
- **Merging the return into the original** — makes removing a header
  impossible.
- **Per-model hooks** — auth is cross-cutting.
