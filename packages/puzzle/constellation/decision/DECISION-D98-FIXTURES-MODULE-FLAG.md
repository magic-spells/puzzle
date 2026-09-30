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
verified_at: '2026-08-24T21:39:15.808Z'
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
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
(`client-runtime/fixtures/`), attaches itself by prototype patching, and is
included in a bundle only by an explicit `--fixtures` flag on `puzzle dev` /
`puzzle build`. Without the flag nothing references the module, so it cannot be
bundled — with any compiler version.

## Runtime: `installFixtures(config)`

- **Adds** `Store.prototype.seed` / `resetFixtureSeed` (removed by
  `uninstall()`); per-store PRNG/mock state lives in a module WeakMap — zero
  fields on the Store.
- **Replaces** `Store.prototype._network` with the mock interception.
  `/fixtures` imports and installs the `/adapter` capability first, so it
  intercepts the same implementation (replicating D91's method/body re-stamp
  elsewhere would drift).
- **Wraps** `PuzzleApp.prototype.mount` to run the config's `setup(app)` at
  `beforeMount` timing — after the user's own hook, before navigation #0 — once
  per mount, not stacked across re-mounts.
- Returns `uninstall()` for test isolation. Also re-exported from `/testing`.
- **Typings:** `types/fixtures.d.ts` adds `seed()`/`resetFixtureSeed()` to
  `Store` by module augmentation, so importing `/fixtures` is what makes
  `store.seed()` type-check.

## Compiler: `--fixtures`

- Wires `app/fixtures.js` (or `.ts`; missing is a clear error), default-exporting
  `{ seed, mock, setup }`.
- Generates a two-module wrapper entry under `<root>/.puzzle/fixtures/` (D153)
  and swaps `EntryPoints`: `wiring.js` imports and calls `installFixtures(config)`;
  the wrapper `app.js` imports `./wiring.js` then the real app entry. **Two
  modules** because static imports hoist — the install must run in a
  dependency's body to precede the app's construction. Keeps the `dist/app.js`
  name.
- The package is `"sideEffects": false`, so the resolver plugin marks exactly
  those two wrapper specifiers `SideEffects: true` (otherwise esbuild emits an
  empty bundle).
- **Rejected with `--static`/`--hybrid`:** prerender runs the app in Node and
  would bake generated records into shipped HTML.
- A one-shot build removes `.puzzle/` only if it created it, so a concurrent
  `puzzle dev --fixtures` session keeps its wrapper.
- The flag is constant per process, so watch mode needs no define-staleness
  logic for fixtures.

## Mock config

Merged per type: `{ ...Model.adapter?.mock, ...config.mock?.[type] }`, active
when either exists. Model-local knobs (`latency`) stay convenient; heavy `data`
arrays belong in the fixtures file so they never ship without the flag. Without
`--fixtures`, a model-declared `mock` is inert data and requests hit the real
endpoint — that is what not passing the flag means.

## Alternatives

- **Usage-scanned defines gating fixture code inside core** (the previous
  approach) — rejected: fail-safe probes mean an older compiler ships the whole
  runtime, and a conservative scan compiles an app's own `store.seed()`
  (`beforeMount` seeding) into production.
- **Pure userland install** — exclusion from production becomes the author's
  hand-rolled env guard.
- **Gating on `__PUZZLE_DEV__`** — dev and build would behave differently, and
  it can't express a `build --fixtures` preview.
- **One wrapper module** — import hoisting runs the app entry first.
- **Mock config only in the fixtures file** — loses convenient model-local knobs.
- **A `dev: { fixtures: true }` config key** — deferred; CLI-only keeps the
  switch explicit.
