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
opt-in subpath, `@magic-spells/puzzle/adapter`, wired once per project as an
app-config capability. Models keep the bare config object they have always
had:

```js
// app/app.js — once per project
import { adapter } from '@magic-spells/puzzle/adapter';

const app = new PuzzleApp({ target: '#app', routes, models, adapter });

// app/models/todo.js — no import, no wrapper
export default class Todo extends PuzzleModel {
  static adapter = { endpoint: '/api/todos' };
}
```

Passing the imported `adapter` binding into the config is a *use* of the
import, so the bundle keeps the module; apps that never pass it ship none of
the adapter — no verbs, no write chain, no `PuzzleAdapterError`, no
fetch/`beforeRequest` plumbing. This is D98's exclusion mechanism — an
unreferenced module is a guarantee — applied to the largest single block of
conditionally-relevant code in the runtime (~515 of store.js's ~1,360 lines).
D89's scan/define gate is structurally unavailable here: the usage signal
lives in JavaScript, and D89 rejected script-token scanning. The design goal
is zero glue in model files: declaring an endpoint is data; enabling the
machinery is one config key.

## Design

**The export is an opaque capability object.** `client-runtime/datastore/adapter.js`
exports `adapter` — a frozen marker whose internal `install()` grafts the
server surface (mixin-style, `Object.defineProperties` of descriptors, one
time, idempotent) onto the existing classes:

- `Store.prototype`: `loadAll`, `loadOne`, `adapter`, `upsert` (the public
  server-authoritative merge), `saveRecord`, `deleteRecord`, `request`, and
  the private dispatch, enhanced-fetch, reconciliation, network, and write-chain
  helpers.
- `PuzzleModel.prototype`: `save`, `delete`.

`PuzzleApp` validates `config.adapter` (anything truthy that is not the
capability — e.g. a stray `{ endpoint }` object — is a construction-time error
naming the import) and installs before constructing the store. Every other
place a store is built from app config honors the same key: the SSG's
node-side prerender stores, the static kernel, and `/testing`'s
`createTestApp` (which passes config through `PuzzleApp`); `mountView` gains a
matching option. Installation happens before any store or record exists, so
nothing can observe a half-enabled state.

**Misconfiguration is loud in dev.** At PuzzleApp construction, a registered
model with a truthy `static adapter` while no capability was passed produces a
dev-only warning naming the model and the fix ("pass `adapter` from
`@magic-spells/puzzle/adapter` to PuzzleApp"). The check inspects config only
— core never references the adapter module — and production builds strip it.
`record.save()` without the capability stays a natural
`TypeError: record.save is not a function` — no stubs, no compiled-out error
text (the D96 lesson).

**What stays in core, deliberately:**

- `_synced`/`_deleted` non-enumerable record fields and `MERGE_SKIP` —
  provenance is shared with persistence (`__synced` in serialized snapshots)
  and hydration.
- `safeMerge`, `recordMutation`, `safeAssignTracked`, `MUTATION_REVISIONS`,
  `recordMutationRevision` — core `update()` depends on the revision stamps;
  the adapter module imports what it needs from model.js.
- The `apiURL` and `beforeRequest` constructor assignments (two lines). The
  config fields are always accepted; without the capability they are stored
  and inert. `beforeRequest`'s documentation and types live with the adapter.
- Store internals the verbs call: `modelFor`, `_typeMap`, `_instantiate`,
  `removeRecord`, `_notify`, `_persist`, `recordKey`.

The per-record write-chain state lives at adapter-module scope keyed by store
(WeakMap — the fixtures `state.js` precedent), so the Store constructor
carries no adapter fields beyond `apiURL`/`beforeRequest`.

**Fixtures.** `/fixtures` imports the capability and installs it during
`installFixtures()`, so `Store.prototype._network` exists for it to replace
and mocked verbs behave identically. Dev-only, so pulling the adapter into
fixture builds costs nothing that ships. The install/uninstall contract is
unchanged.

**Types via module augmentation** (the D98 pattern): `types/adapter.d.ts`
declares the capability and augments `Store`/`PuzzleModel` with the verbs, so
`record.save()` type-checks only in programs that import `/adapter`. The core
declarations in `types/index.d.ts` shed the adapter members; `PuzzleAppConfig`
types `adapter?:` as an opaque branded interface so a raw object is a type
error too. `PuzzleAdapterError` is exported from `/adapter` and no longer from
the root entry.

**Wiring.** The subpath needs the four-place plumbing: a `package.json`
`exports` entry, `types/adapter.d.ts`, a `tests-types/tsconfig.json` mapping,
and an explicit `Alias` line in `configureRuntime`
(`compiler/internal/build/options.go`) — subpaths never resolve through the
bare alias. Vitest tests import the module by relative path
(`../client-runtime/datastore/adapter.js`); the vitest alias maps only the
bare specifier, and a subpath specifier in tests would prefix-match it.

**Scope after D158: this is Puzzle's server-adapter capability.** Endpoint
shorthand generates the resource-shaped REST convention; author fetch functions
may speak GraphQL, RPC, or bespoke HTTP while retaining the same normalized
Store reconciliation and network seam. A future protocol-specific sibling
subpath is needed only if it brings machinery beyond fetch functions, never
merely to select a different URL or payload shape.

## Alternatives rejected

- **Keeping the adapter fused into the core store** — a model's config object
  is invisible to the bundler, so every app shipped the full adapter whether
  or not any model declared one (measured: ~5.6 KB raw / ~1.6 KB gzip in apps
  with no server at all). This was the status quo being removed.
- **A per-model factory (`static adapter = adapter({ endpoint })`)** — the
  strongest alternative: it colocates proof with declaration (a config cannot
  exist without the machinery) and gives each model an explicit rewire point
  for future protocol migration. Rejected on the no-glue-code goal: it puts an
  import plus a wrapper call in every server-backed model file, forever, to
  guard against a failure mode the dev-time warning catches anyway. The
  rewire-point value survives — a future non-REST adapter would use per-model
  declarations of its own regardless of how REST is enabled.
- **A floating `enableAdapter()` call** — same semantics as the config key
  but less discoverable: a loose statement in app.js rather than a line in the
  one config block every Puzzle app already reads and documents.
- **A bare side-effect import (`import '@magic-spells/puzzle/adapter'`)** —
  requires a `sideEffects` allowlist, is invisible to unused-import linting by
  design, and decouples the import from anything that uses it; a stale one
  ships 1.6 KB forever with no tool able to flag it.
- **A D89 scan/define gate** — requires detecting adapter config inside opaque
  script bytes; D89 rejected script-token scanning, and D96/D98 demonstrated
  the stale-binary and false-positive hazards of scanning for JS-side signals.
- **Throwing stubs left in core** (`save()` that explains the missing
  capability) — D96 measured ~1 KB of "compiled out" error text shipping in
  every bundle; the bare TypeError plus the dev-time warning covers the same
  diagnosis for free.
