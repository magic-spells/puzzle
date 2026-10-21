---
name: D189 — ctx.idle, catch-all results and public model lookup
status: built
connections:
  - FEATURE-AGENT-HOOKS
  - DECISION-D182-NAVIGATION-RESULT
  - DECISION-D185-APP-IDLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - DOC-SPEC-ROUTER
  - DOC-SPEC-ANATOMY
  - DOC-SPEC-DATA
  - DOC-DATASTORE
  - DOC-RELEASE-SURFACE
---

## Context

Reusable components (the agent kit's first) need three things app code already has: a way to wait for the app to settle, a way to tell a catch-all landing from a real route, and a way to read a model's primary key. Without them a library component needs the app handed to it by hand, treats `push('/nope')` landing on `*` as an ordinary success (`'not-found'` only fires in apps with no catch-all), and reads store internals.

## Decision

- **`ctx.idle(options?)`** is `app.idle` bound to the app, set once in `mount()` beside `store`, `router` and `formatters`. Adapter-derived view contexts inherit it through the prototype chain. It can be destructured. Same contract as D185.
- **`catchAll: true` on the ok result** exactly when the committed leaf is the top-level `path: '*'` route; ordinary results omit it. A module-level `succeed(route)` builds every success result, so push, replace, same-path no-ops, reused-chain commits and redirect landings all carry it. `ok` stays `true`: the fallback view committed. `'not-found'` keeps meaning no match and no catch-all.
- **`store.modelFor(type)` is public** (it already existed for the adapter): the registered constructor for an own registry key, otherwise `PuzzleModel`. Static `Model.primaryKey()` is declared on the model type: the first schema field marked `.primary()`, or `'id'`. Both are typed. The adapter's per-view store handle forwards it bound to the raw store. Lookup never reads records, subscribes or fetches.

## Alternatives rejected

- **The whole app on ctx** — every component gains access to mount/unmount and config; one bound function is the capability needed.
- **`catchAll` on the route snapshot** — the snapshot is shared with guards, `router.current` and `view.route`; the flag describes the navigation's outcome, and `snapshot.route.path === '*'` already answers it for a snapshot holder.
- **Catch-all as `ok: false`** — the URL and view committed; a failure reason would make callers undo a successful navigation.

## Consequences

About 35 bytes gzip on hello-world. A nested catch-all does not exist (the router rejects `path: '*'` inside `children`), so the flag has one meaning.

`ctx.idle` exists wherever a `PuzzleApp` builds the ctx, and under `/testing`'s `mountView`, where it runs `settled()` and resolves `true`. The prerender and `output: 'static'` page contexts (`{ store, router, formatters }`) carry no `idle`: they have no app and no navigation to wait on, and adding it there would ship bytes no caller has asked for.
