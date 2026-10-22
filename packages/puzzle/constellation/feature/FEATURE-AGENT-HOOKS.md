---
name: Agent-kit hooks — ctx.idle, catchAll result, public modelFor
status: built
release: RELEASE-V0-9-0
change: feature
branch: feat/agent-hooks
connections:
  - DECISION-D189-AGENT-HOOKS
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - DOC-SPEC-ROUTER
  - DOC-SPEC-ANATOMY
  - DOC-RELEASE-SURFACE
---


# Agent-kit hooks — ctx.idle, catchAll result, public modelFor

```js
await this.ctx.idle();                                  // same as app.idle()
const r = await this.ctx.router.push('/nope');          // { ok: true, route, catchAll: true }
const pk = this.ctx.store.modelFor('todo').primaryKey(); // 'id' unless a field is .primary()
```

The design is [[DECISION-D189-AGENT-HOOKS]].

## Scope

- `client-runtime/app.js`: `idle: this.idle.bind(this)` on the app ctx.
- `client-runtime/router/router.js`: module-level `succeed(route)` used by every success exit.
- `client-runtime/datastore/store.js`: `modelFor` documented as public.
- `types/index.d.ts`: `PuzzleContext.idle`, `NavigationResult.catchAll`, `Store.modelFor`, static `PuzzleModel.primaryKey()`.

## Tests

- `tests/app-idle.test.js`: a nested component's `ctx.idle` is the app's, destructured, with and without the adapter.
- `tests/router-navigation-result.test.js`: catch-all push, reused-route and no-op push/replace, redirect onto the catch-all; ordinary results omit the flag.
- `tests/store.test.js`: `modelFor` and `primaryKey()` through the raw store and the adapter handle, inherited keys fall back to `PuzzleModel`.
- `tests-types/consumer.ts`: all three APIs.
