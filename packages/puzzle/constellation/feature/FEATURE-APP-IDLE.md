---
name: app.idle() — wait for the app to go quiet
status: built
release: RELEASE-V0-9-0
change: feature
branch: feat/app-idle
connections:
  - DECISION-D185-APP-IDLE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ROUTER
  - COMPONENT-STORE
  - DOC-SPEC-ANATOMY
  - DOC-TESTING
  - DOC-RELEASE-SURFACE
---

# app.idle() — wait for the app to go quiet

```js
const quiet = await app.idle({ timeout: 10000 }); // true when idle; false on timeout
```

The design and its rationale are [[DECISION-D185-APP-IDLE]].

## Scope

- `PuzzleApp.prototype.idle` in `client-runtime/app.js`: one method reading the mount promise, the store's scheduled flush and async-evaluation chain, the router's in-flight navigation, and the adapter's read state.
- `client-runtime/router/router.js`: the exported `navigating(router)` bound in Router's static block.
- `client-runtime/datastore/adapter.js`: `_reading()` on the installed store methods; `tests-types/runtime/installed.d.ts` declares it optional.
- `types/index.d.ts`: `idle()` on `PuzzleApp`.
- Docs: [[DOC-SPEC-ANATOMY]] §2, [[DOC-TESTING]] (how it differs from `settled()`), [[DOC-RELEASE-SURFACE]], CHANGELOG 0.9.0.

## Tests

`tests/app-idle.test.js`: idle right after mount; a slow async `data()` started by a store change; an in-flight push held by an async guard; a store change flushing and re-rendering; a held store flush; a `setData()` render; an adapter app's fetch-backed `findOne` from a sync `data()`; timeout returns false; a bad timeout logs and resolves; a hidden tab with a frozen rAF; a visible tab whose rAF never fires; a mount held in `beforeMount`; never mounted and after unmount. Each state read was checked by disabling it and watching its test fail. A production `examples/hello-world` build carries the `_reading?.()` call site and none of the adapter module.

## Out of scope

AgentKit's driver moves from polling to `push()` results plus `app.idle()` after 0.9.0 is published, in its own repo.
