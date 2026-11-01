---
name: D98 — Self-contained fixtures module + the --fixtures flag
status: verified
connections:
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - DECISION-D89-FEATURE-USAGE-TREESHAKE
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D94-TESTING-EXPORT
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-TESTING
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/fixtures/index.js
  - client-runtime/fixtures/state.js
  - client-runtime/fixtures/generator.js
  - client-runtime/fixtures/mock.js
  - client-runtime/datastore/adapter.js
  - compiler/internal/build/fixtures.go
---

# D98 — Self-contained fixtures module + the `--fixtures` flag

D95's fixture/mock system lives entirely in `@magic-spells/puzzle/fixtures`
(`client-runtime/fixtures/`), attaches itself by prototype patching, and enters
a bundle only through an explicit `--fixtures` flag on `puzzle dev` /
`puzzle build`. Without the flag nothing imports the module, so nothing of it
can ship — no define, no dead branch.

## Runtime: `installFixtures(config)`

- **Adds** `Store.prototype.seed` / `resetFixtureSeed` (deleted by
  `uninstall()`); per-store PRNG/mock state lives in a module WeakMap
  (`state.js`) — zero fields on the Store.
- **Replaces** `Store.prototype._network` with the mock interception. It
  installs the `/adapter` capability first (D157), so it intercepts the same
  `_fetch` → `_network` path (replicating D91's method/body re-stamp elsewhere
  would drift).
- **Wraps** `PuzzleApp.prototype.mount` to run the config's `setup(app)` at
  `beforeMount` timing — after the app's own hook, before navigation #0 — once
  per mount, not stacked across re-mounts.
- Validates its config (`{ seed, mock, setup }`), returns `uninstall()` for test
  isolation, and is re-exported from `/testing`.
- **Typings:** `types/fixtures.d.ts` adds `seed()`/`resetFixtureSeed()` to
  `Store` by module augmentation, so importing `/fixtures` is what makes
  `store.seed()` type-check.

## Compiler: `--fixtures` (`compiler/internal/build/fixtures.go`)

- Wires `app/fixtures.js` (or `.ts`; missing is a clear error), which
  default-exports `{ seed, mock, setup }`.
- Generates a two-module wrapper entry under `<root>/.puzzle/fixtures/` (D153)
  and swaps `EntryPoints`: `wiring.js` imports and calls
  `installFixtures(config)`; the wrapper `app.js` imports `./wiring.js` then the
  real app entry. **Two modules** because static imports hoist — the install
  must run in a dependency's body to precede the app's construction. The output
  stays `dist/app.js`.
- The package is `"sideEffects": false`, so the resolver plugin marks exactly
  those two wrapper specifiers `SideEffects: true` (otherwise esbuild emits an
  empty bundle).
- **Rejected with `output: 'static'`/`'hybrid'`:** prerender runs the app in Node
  and would bake generated records into shipped HTML.
- A one-shot build removes `.puzzle/` only if it created it, so a concurrent
  `puzzle dev --fixtures` session keeps its wrapper.
- The flag is constant per process, so watch mode needs no define-staleness
  logic for fixtures.

## Mock config placement

Model-local knobs (`static adapter = { mock: { latency } }`) stay convenient;
heavy `data` arrays belong in the fixtures file so they never ship. Without
`--fixtures`, a model-declared `mock` is inert data and requests hit the real
endpoint.

## Alternatives rejected

- **Usage-scanned defines gating fixture code inside the core** — fail-safe
  probes mean a compiler that doesn't set them ships the whole thing, and a
  conservative scan compiles an app's own `store.seed()` (`beforeMount`
  seeding) into production.
- **Pure userland install** — production exclusion becomes the author's
  hand-rolled env guard.
- **Gating on `__PUZZLE_DEV__`** — dev and build would differ, and it can't
  express a `build --fixtures` preview.
- **One wrapper module** — import hoisting runs the app entry first.
- **Mock config only in the fixtures file** — loses convenient model-local knobs.
- **A `dev: { fixtures: true }` config key** — CLI-only keeps the switch
  explicit.
