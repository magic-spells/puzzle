---
name: 'D91 — `beforeRequest`: one synchronous hook on every adapter fetch (v1.55)'
status: verified
connections:
  - COMPONENT-STORE
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D81-STATIC-PAGES-MODE
  - DOC-SPEC
  - DOC-DATASTORE
  - FILE-ADAPTER
verified_at: '2026-08-16T04:49:17.153Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

Every adapter fetch routes through one private `Store._fetch(url, init, context)`
installed by `@magic-spells/puzzle/adapter`, and an optional `beforeRequest` hook
on the app config gets to shape the `init` before it goes out. This is how an app
attaches auth headers, `credentials`, or an `AbortSignal` to the whole adapter
surface at once.

## Context

`store.loadMany()` / `loadOne()` were literally `await fetch(this.apiURL + endpoint + suffix)` — a bare fetch with **no init object at all**. No headers, no `credentials`, no `AbortSignal`, no cancellation.

## Decision

One seam, one hook, deliberately narrow.

- **`Store._fetch(url, init, context)` is the only place generated transports, D158's enhanced fetch, and `store.request()` reach the network.** Global fetch used explicitly by author code bypasses it. `_` prefix, not `#` — the datastore is uniformly `_` helpers.
- **The read path sends an explicit `{ method: 'GET' }`** rather than a bare `fetch(url)`. Identical on the wire, and it means a hook never has to special-case the read path against a missing init.
- **The hook is synchronous** and may either mutate `init` in place *or* return a replacement object; a truthy object return wins, otherwise the possibly-mutated original is used. Both shapes are supported deliberately — mutation reads better for pushing a header, a return for a spread. A returned replacement is shallow-COPIED before the method/body re-stamp: the store never writes into an object the app owns, so `Object.freeze({ ...init, … })` and getter-only fields are supported shapes, not TypeErrors.
- **`method` and `body` are re-stamped from the original init after the hook runs.** This is load-bearing, not defensive. The write path captures `requestKey = record[pk]` *before* the await and reconciles against exactly that key afterwards (§22, D50); a hook that flipped POST→PUT or rewrote the body would silently break identity re-checks, pk adoption, and the `_synced` contract. The URL is a separate `fetch` argument, so it is out of reach by construction. A hook can change *how* a request is sent, never *what* it is.
- **The context argument is frozen.** It is information about the request, not a second output channel.
- **A throwing hook is not caught.** It is app code, and an auth error raised there must reject the calling verb rather than ship an unauthenticated request. Every caller is async, so it surfaces as a rejection.
- **The Store keeps it only when it is a function**, and null otherwise, so the overwhelmingly common no-hook path costs one truthiness check and nothing else. The app config value is handed straight through to the Store, which owns that normalization rather than making every caller repeat it.

## Consequences

- Authenticated apps can use `loadMany`/`loadOne`/`save`/`delete` as designed instead of routing around them — and since D161, the tracked fault path inherits the hook the same way (it runs these same verbs).
- Request cancellation falls out for free — the app attaches its own `AbortSignal`.
- The prerender path carries the hook too (`ssg/index.js` `buildContext`), so a build-time `beforeMount` store seed hits an authenticated API the same way the browser store would.
- **`output: 'static'` cannot carry the hook.** `mountStatic` takes no `beforeRequest` option: a page entry's options are serialized into a Go-generated module, and a function does not survive that boundary. True-static pages get no hook on their client-side store. This is a documented limitation of the output mode, not a bug to fix here; closing it needs the page entry to bind the value from a real module import, the way it binds the adapter capability.
- **Returning a bare replacement object drops the original headers.** `return {}` on a write loses `Content-Type: application/json`. That is the "replacement wins" contract behaving as specified — the idiom is `return { ...init, headers: … }`. Merging instead was rejected: it would make removing a header impossible.
- Regression tests pin the exact call shape of all four verbs with no hook configured, which is what keeps the re-stamp and the explicit read-path init honest.

## Alternatives rejected

- **An async hook.** The obvious next ask is inline token refresh, but it puts an `await` in front of every adapter call and needs a story for coalescing concurrent refreshes against the D50 per-record save chain. Refresh arguably belongs in a wrapper around the verb, not in a per-request hook. Widening sync→async later is easy; narrowing is not.
- **Letting the hook rewrite method/URL/body** — breaks D50 identity reconciliation, as above.
- **Merging the returned object into the original** instead of replacing — no way to remove a header, and two mental models for one return value.
- **A store-wide `fetch` replacement option** (`options.fetch = customFetch`) — still rejected. D158's function argument is different: a per-store enhanced platform primitive owned by the adapter module, with D50 reconciliation remaining behind the transport return.
- **Per-model hooks** rather than one store-level hook — auth is overwhelmingly cross-cutting, and per-model overrides can be layered on later without changing this surface.
