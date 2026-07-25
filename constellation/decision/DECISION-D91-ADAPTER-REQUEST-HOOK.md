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
verified_at: '2026-07-25T05:24:29.299Z'
verified_sha: 47b929360bc00d6c19b4b39113a4b502e7957952
---

Every adapter fetch now routes through one private `Store._fetch(url, init, context)`, and an optional `beforeRequest` hook on the app config gets to shape the `init` before it goes out. This is how an app attaches auth headers, `credentials`, or an `AbortSignal` to the whole adapter surface at once.

## Context

`store.loadAll()` / `loadOne()` were literally `await fetch(this.apiURL + endpoint + suffix)` — a bare fetch with **no init object at all**. No headers, no `credentials`, no `AbortSignal`, no cancellation.

The consequence was worse than an inconvenience: an app with token auth **could not use the D21 read path at all**. Its only recourse was to hand-roll `store.request()` (which did accept per-call headers) followed by `store.upsert()`, which bypasses exactly the adapter design D21 and D50 exist to provide. Every comparable framework has this seam — Angular `HttpInterceptor`, Ember Data adapter `headers`, Axios interceptors.

The four fetch sites had also drifted apart: the read path passed nothing, `_saveRecordNow` hardcoded `Content-Type`, `deleteRecord` passed only `{ method: 'DELETE' }`, and `request()` merged caller headers.

## Decision

One seam, one hook, deliberately narrow.

- **`Store._fetch(url, init, context)` is the only place the adapter calls `fetch`.** All four sites route through it. `_` prefix, not `#` — `store.js` has no `#` members anywhere; `app.js` and `router.js` do, but this file is uniformly `_`.
- **The read path now sends an explicit `{ method: 'GET' }`** rather than a bare `fetch(url)`. Identical on the wire, and it means a hook never has to special-case the read path against a missing init.
- **The hook is synchronous** and may either mutate `init` in place *or* return a replacement object; a truthy object return wins, otherwise the possibly-mutated original is used. Both shapes are supported deliberately — mutation reads better for pushing a header, a return for a spread. A returned replacement is shallow-COPIED before the method/body re-stamp: the store never writes into an object the app owns, so `Object.freeze({ ...init, … })` and getter-only fields are supported shapes, not TypeErrors.
- **`method` and `body` are re-stamped from the original init after the hook runs.** This is load-bearing, not defensive. The write path captures `requestKey = record[pk]` *before* the await and reconciles against exactly that key afterwards (§22, D50); a hook that flipped POST→PUT or rewrote the body would silently break identity re-checks, pk adoption, and the `_synced` contract. The URL is a separate `fetch` argument, so it is out of reach by construction. A hook can change *how* a request is sent, never *what* it is.
- **The context argument is frozen.** It is information about the request, not a second output channel.
- **A throwing hook is not caught.** It is app code, and an auth error raised there must reject the calling verb rather than ship an unauthenticated request. Every caller is async, so it surfaces as a rejection.
- **Stored only when it is a function**, so the overwhelmingly common no-hook path costs one truthiness check and nothing else.
- **Threaded conditionally from config**, matching the established `storage` / `routerMode` / `routerBase` convention where an option is passed through only when set so the constructee's own default stands.

## Consequences

- Authenticated apps can use `loadAll`/`loadOne`/`save`/`delete` as designed instead of routing around them.
- Request cancellation falls out for free — the app attaches its own `AbortSignal`.
- The prerender path carries the hook too (`ssg/index.js` `buildContext`), so a build-time `beforeMount` store seed hits an authenticated API the same way the browser store would.
- **`output: 'static'` cannot carry the hook.** `mountStatic`'s options are serialized into a Go-generated per-page entry module, and a function does not survive that boundary. True-static pages get no hook on their client-side store. This is a documented limitation of the output mode, not a bug to fix here; closing it needs a different mechanism (the page module wiring it itself).
- **Returning a bare replacement object drops the original headers.** `return {}` on a write loses `Content-Type: application/json`. That is the "replacement wins" contract behaving as specified — the idiom is `return { ...init, headers: … }`. Merging instead was rejected: it would make removing a header impossible.
- Three pre-existing read-path assertions moved from `toHaveBeenCalledWith(url)` to `toHaveBeenCalledWith(url, { method: 'GET' })`. They were asserting argument count, not behavior; the replacement regression tests pin the exact call shape of all four verbs with no hook configured, which is a stronger guarantee than what they replaced.

## Alternatives rejected

- **An async hook.** The obvious next ask is inline token refresh, but it puts an `await` in front of every adapter call and needs a story for coalescing concurrent refreshes against the D50 per-record save chain. Refresh arguably belongs in a wrapper around the verb, not in a per-request hook. Widening sync→async later is easy; narrowing is not.
- **Letting the hook rewrite method/URL/body** — breaks D50 identity reconciliation, as above.
- **Merging the returned object into the original** instead of replacing — no way to remove a header, and two mental models for one return value.
- **A `fetch` replacement option** (`options.fetch = customFetch`) — strictly more powerful, but it moves responsibility for the whole request contract to the app and would let a bad implementation break the D50 guards silently. The narrow hook is the safer default; a fetch override can still be added later if real demand appears.
- **Per-model hooks** rather than one store-level hook — auth is overwhelmingly cross-cutting, and per-model overrides can be layered on later without changing this surface.
