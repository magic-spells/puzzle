---
name: D157 — Server adapter as the /adapter subpath
status: verified
connections:
  - DECISION-D21-ADAPTER-READ-PATH
  - DECISION-D50-ADAPTER-WRITE-SYNC
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D98-FIXTURES-MODULE-FLAG
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D158-ADAPTER-FETCH-FUNCTIONS
  - DECISION-D161-AUTO-FETCHING-FINDS
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ESBUILD-PLUGIN
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
verified_at: '2026-08-24T21:39:23.520Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
code_refs:
  - client-runtime/datastore/adapter.js
  - client-runtime/capabilities.js
  - client-runtime/app.js
  - client-runtime/views/PuzzleView.js
  - client-runtime/fixtures/index.js
  - compiler/internal/build/prerender_pages.go
  - compiler/internal/build/options.go
  - types/adapter.d.ts
---

# D157 — Server adapter as the /adapter subpath

## Context

The server adapter (D21 read path, D50 write path, `store.request()`,
`PuzzleAdapterError`, D91 `beforeRequest` threading) is the largest block of
conditionally relevant runtime code. A model's `static adapter` config is
invisible to the bundler, and D89's scan/define gate can't see JS-side signals,
so an adapter fused into core ships to every app.

## Decision

The adapter lives in the opt-in subpath `@magic-spells/puzzle/adapter`, wired
once per project as an app-config capability; models keep a plain config
object:

```js
// app/app.js
import { adapter } from '@magic-spells/puzzle/adapter';
const app = new PuzzleApp({ target: '#app', routes, models, adapter });

// app/models/todo.js — no import, no wrapper
export default class Todo extends PuzzleModel {
  static adapter = { endpoint: '/api/todos' };
}
```

Passing the binding is a use of the import, so apps that never pass it ship
none of the adapter (D98's exclusion-by-unreferenced-module).

- **Opaque capability.** `client-runtime/datastore/adapter.js` exports a frozen
  `adapter` whose internal, idempotent `install()` grafts descriptors onto
  `Store.prototype` (`loadMany`, `loadOne`, `adapter`, `upsert`, `saveRecord`,
  `deleteRecord`, `request`, private dispatch/network/write-chain helpers),
  `PuzzleModel.prototype` (`save`, `delete`) and `PuzzleView.prototype` (the
  [[DECISION-D161-AUTO-FETCHING-FINDS]] settle executor `_settleData`; core
  keeps only the call seam).
- **Install before any store exists.** `PuzzleApp` rejects a truthy non-capability
  `config.adapter` (e.g. a stray `{ endpoint }`) naming the import, then
  installs before constructing the store. SSG prerender stores, the static
  kernel, `/testing`'s `createTestApp` and `mountView` honor the same key.
- **Dev warning.** At mount, a model with a truthy `static adapter` and no
  capability warns, naming the model and the fix. Without the capability,
  `record.save()` is a plain `TypeError` — no stubs (D98).
- **Core keeps**: `_synced`/`_deleted` and `MERGE_SKIP` (provenance shared with
  persistence and hydration); `safeMerge`, `safeAssignTracked`,
  `recordMutation`, `MUTATION_REVISIONS` (core `update()` needs them); the inert
  `apiURL`, `beforeRequest` and `_a` constructor assignments (`_a` lets the
  adapter read D158 defaults); store internals the verbs call (`modelFor`,
  `_typeMap`, `_instantiate`, `removeRecord`, `_notify`, `_persist`,
  `recordKey`).
- Per-record write-chain state and D161 read-state caches live at adapter
  module scope in WeakMaps keyed by store; the static kernel reaches read-state
  codecs through the `capabilities.js` relay.
- **Fixtures** (`/fixtures`) install the capability in `installFixtures()` so
  `Store.prototype._network` exists to mock.
- **Types via augmentation**: `types/adapter.d.ts` declares the capability and
  augments `Store`/`PuzzleModel`, so `record.save()` type-checks only when
  `/adapter` is imported. `PuzzleAppConfig.adapter` is a branded interface.
  `PuzzleAdapterError` is exported from `/adapter` only.
- **Wiring** (every subpath): `package.json` `exports`, `types/adapter.d.ts`,
  a `tests-types/tsconfig.json` mapping, and an explicit `Alias` in
  `configureRuntime` (`compiler/internal/build/options.go`). Vitest imports the
  module by relative path (the bare-specifier alias would prefix-match a
  subpath).

**Static output binds the same capability value.** Static pages have no
`app.js`; each generated page entry must reach the exact value the prerender
installed. The prerender summary reports `adapterConfigured` and
`adapterModuleMatches`, and the build picks the cheapest tier:

1. **Bare** — config passed the bare export; the entry re-imports it.
2. **Conventional** — config passed a configured capability that is identical
   (checked by namespace-import in the prerender) to the default export of
   `app/adapter.js`/`.ts` ([[DECISION-D158-ADAPTER-FETCH-FUNCTIONS]]); the entry
   imports that module.
3. **Capture** — otherwise the entry imports the app entry and reads
   `app.config.adapter`; `__PUZZLE_CAPTURE__` (true only for the per-page static
   pass) makes a top-level `app.mount()` inert. Costs page weight, reported in
   an advisory line; never an error.

Scope: this is the server-adapter capability for any protocol — endpoint
shorthand generates REST, author fetch functions (D158) may speak GraphQL, RPC
or bespoke HTTP through the same reconciliation seam. A sibling subpath is
warranted only for machinery beyond fetch functions.

## Alternatives

- Per-model factory (`static adapter = adapter({ endpoint })`) — colocates
  proof with declaration but adds glue to every model file; the dev warning
  catches the failure it guards against.
- Floating `enableAdapter()` call or bare side-effect import — less
  discoverable; a side-effect import needs a `sideEffects` allowlist and a stale
  one can't be flagged.
- D89 scan/define gate — needs scanning opaque script bytes.
- Trusting `app/adapter.js` by name in static builds — pages could install a
  different adapter than they were rendered with.
- Requiring `app/adapter.js` — makes legal app code a build error.
- Throwing stubs in core — ships error text in every bundle (D98).

## Consequences

No-server apps ship no adapter code. Enabling the adapter is one config key;
declaring an endpoint is data.
