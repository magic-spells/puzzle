---
name: D157 — Server adapter as the /adapter subpath (v1.72)
status: built
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
---

The server adapter — the D21 read path, the D50 write path, `store.request()`,
`PuzzleAdapterError`, and the D91 `beforeRequest` threading — lives in its own
opt-in subpath, `@magic-spells/puzzle/adapter`, not in the core store. An app
declares server sync by importing a factory and using its return value as the
model's adapter config:

```js
import { adapter } from '@magic-spells/puzzle/adapter';

export default class Todo extends PuzzleModel {
  static adapter = adapter({ endpoint: '/api/todos' });
}
```

Apps that never import the subpath ship none of the adapter: no verbs, no write
chain, no `PuzzleAdapterError`, no fetch/`beforeRequest` plumbing. This is
D98's exclusion mechanism — an unreferenced module is a guarantee — applied to
the largest single block of conditionally-relevant code in the runtime (~515 of
store.js's ~1,360 lines). D89's scan/define gate is structurally unavailable
here: the usage signal (`static adapter = …`) lives in JavaScript, and D89
rejected script-token scanning.

## Design

**Factory-call installation (no top-level side effects).** The module
`client-runtime/datastore/adapter.js` exports `adapter(config)`. The first call
installs — behind an idempotent guard — the adapter surface onto the existing
classes:

- `Store.prototype`: `loadAll`, `loadOne`, `upsert` (the public
  server-authoritative merge), `saveRecord`, `deleteRecord`, `request`, and the
  private helpers (`_fetchAdapter`, `_upsert`, `_requireEndpoint`, `_fetch`,
  `_network`, `_chain`, `_saveRecordNow`, `_deleteRecordNow`).
- `PuzzleModel.prototype`: `save`, `delete`.

It then validates and returns the config object for the `static adapter` field.
Model modules evaluate `static adapter = adapter({...})` at import time, so
installation always precedes store construction. In dev mode, a bare object
literal (`static adapter = { endpoint }`) that reaches the store without the
factory wrapper warns once with the migration instruction.

`PuzzleAdapterError` and `readBody` move into the module; `PuzzleAdapterError`
is exported from `/adapter` and no longer from the root entry. The per-record
write-chain state (`_writeChains`) moves to module scope keyed by store
(WeakMap — the fixtures `state.js` precedent), so the Store constructor carries
no adapter fields beyond `apiURL`/`beforeRequest`.

**What stays in core, deliberately:**

- `_synced`/`_deleted` non-enumerable record fields and `MERGE_SKIP` —
  provenance is shared with persistence (`__synced` in serialized snapshots)
  and hydration.
- `safeMerge`, `recordMutation`, `safeAssignTracked`, `MUTATION_REVISIONS`,
  `recordMutationRevision` — core `update()` depends on the revision stamps;
  the adapter module imports what it needs from model.js.
- The `apiURL` and `beforeRequest` constructor assignments (two lines). The
  config fields are always accepted; without the import they are stored and
  inert. `beforeRequest`'s documentation and types live with the adapter.
- Store internals the verbs call: `modelFor`, `_typeMap`, `_instantiate`,
  `removeRecord`, `_notify`, `_persist`, `recordKey`.

**No-adapter behavior.** `record.save()` in an app that never imported the
subpath is a natural `TypeError: record.save is not a function` — no stubs, no
compiled-out error text (the D96 lesson).

**Fixtures.** `/fixtures` imports and invokes the adapter factory, so
`Store.prototype._network` exists for `installFixtures` to replace and mocked verbs behave identically.
Dev-only, so pulling the adapter into fixture builds costs nothing that ships.
The install/uninstall contract is unchanged.

**SSG.** No special handling: a `data()` that calls `loadAll` lives in an app
whose model imported `/adapter`, so the node prerender bundle carries it for
exactly the apps that need it.

**Types via module augmentation** (the D98 pattern): `types/adapter.d.ts`
declares the factory and augments `Store`/`PuzzleModel` with the verbs, so
`record.save()` type-checks only in programs that import `/adapter`. The core
declarations in `types/index.d.ts` shed the adapter members.

**Wiring.** The subpath needs the four-place plumbing: a `package.json`
`exports` entry, `types/adapter.d.ts`, a `tests-types/tsconfig.json` mapping,
and an explicit `Alias` line in `configureRuntime`
(`compiler/internal/build/options.go`) — subpaths never resolve through the
bare alias. Vitest tests import the module by relative path
(`../client-runtime/datastore/adapter.js`); the vitest alias maps only the bare
specifier, and a subpath specifier in tests would prefix-match it.

## Alternatives rejected

- **Keeping `static adapter = {...}` as a plain config object** — a config
  object is invisible to the bundler, so every app ships the full adapter
  whether or not any model declares one. This was the status quo being removed.
- **A D89 scan/define gate** — requires detecting `static adapter` inside the
  opaque `<script>` body; D89 rejected script-token scanning, and D96/D98
  demonstrated the stale-binary and false-positive hazards of scanning for
  JS-side signals.
- **Throwing stubs left in core** (`save()` that explains the missing import) —
  D96 measured ~1 KB of "compiled out" error text shipping in every bundle;
  the bare TypeError plus a dev-mode warning at config time covers the same
  diagnosis for free.
- **Top-level side-effect installation on import** — works under
  `sideEffects: false` only while the import is also *used*; the explicit
  factory call is the D98 house pattern, is robust to future refactors that
  might leave a bare import behind, and gives the factory a natural place to
  validate config.
