---
name: D98 — Self-contained fixtures module + the --fixtures flag (v1.61)
status: verified
connections:
  - DECISION-D95-FIXTURES-MOCK-ADAPTER
  - DECISION-D96-FIXTURE-MOCK-TREESHAKE
  - DECISION-D91-ADAPTER-REQUEST-HOOK
  - DECISION-D94-TESTING-EXPORT
  - COMPONENT-STORE
  - COMPONENT-PUZZLE-APP
  - COMPONENT-ESBUILD-PLUGIN
  - COMPONENT-COMPILER-CLI
  - DOC-SPEC
  - DOC-TESTING
verified_at: '2026-08-16T04:49:20.859Z'
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
notes:
  - kind: verified
    text: >-
      Verified end-to-end at working-tree state (uncommitted, branch feat/framework-gaps): 1168
      Vitest + 14 Go packages green, test:types + verify:pack pass, todos plain build 62560/20414
      (zero fixture markers), --fixtures build 70599/23439 (markers present, .puzzle cleaned),
      real-browser smoke of `puzzle dev --fixtures` rendered 4 explicit + 3 schema-generated seeded
      todos with a clean console.
    sha: 599b1a987c7c81068d50570cfe8bd1cd7ffbfcee
  - kind: verified
    text: >-
      Post-merge re-verify on main (PR #22 merge + morph bug fix): 64 files / 1170 Vitest and 14 Go
      packages green in a clean worktree at this sha (compiled-fixture pretest run first — fresh
      checkouts need it).
    sha: a72c1eb93fd8d536a9c270b0b3513c96c363705c
---

The D95 fixture/mock system moves out of the core store into a self-contained
`@magic-spells/puzzle/fixtures` module that **attaches itself** via prototype
patching, selected by an explicit `--fixtures` flag on `puzzle dev` and
`puzzle build`. Supersedes D96 entirely (its scan/define machinery for
fixtures/mock reverts; D89's flip/head-tags scanning is untouched). D95's
feature surface — `seed()`, the mock verbs, latency/failRate, seeded
determinism — is unchanged; only how it integrates and ships changes.

## Context

D96 kept D95's runtime out of production by usage-scanned defines, but the
integration itself stayed in core: **154 added lines in `store.js`** (13 inline
probe sites, the constructor PRNG block, `seed()`/`resetFixtureSeed()`, the
`_fetch` mock branch), 15 in `app.js`, and ~1 KB of "compiled out" error text
that ships in every bundle as throwing stubs. Two structural hazards surfaced
in practice, on top of Cory's direct objection to the core clutter:

1. **Stale-binary hazard.** The probes are fail-safe — an absent define reads
   as *enabled* — so any compiler older than D96 ships the entire fixture
   runtime. Measured: the repo-root `./puzzle` built one commit behind D96
   produced `examples/todos` at 70195 raw / 23025 gzip (`fixtureSeed` ×10)
   vs 63317 / 20702 from the current compiler. Tree-shaking that depends on
   the compiler being new enough is not a guarantee; an unreferenced module
   is.
2. **Scan false-positives ship test code into production.** The token scan is
   conservative by design, so an app that calls `store.seed()` anywhere in its
   own source — the documented `beforeMount` seeding pattern — gets the
   generator (and its seeding) compiled into its production bundle. The author
   had to hand-guard the calls; the mechanism couldn't distinguish "uses
   fixtures in dev" from "wants fixtures in prod."

## Decision

**Runtime.** All fixture/mock code lives in `client-runtime/fixtures/`
(`index.js` + `generator.js` + `mock.js` + `state.js`), exported as
`@magic-spells/puzzle/fixtures` and re-exported from `/testing`.
`installFixtures(config)` patches from outside — JS resolves methods at call
time, so nothing needs to be pre-wired:

- `Store.prototype.seed` / `resetFixtureSeed` are **added** by install (and
  deleted by `uninstall()`); per-store PRNG/mock state lives in a module
  `WeakMap`, zero fields on the store.
- Mock interception replaces `Store.prototype._network` — the single place an
  adapter request touches `fetch`, installed by the `/adapter` capability and
  imported explicitly by `/fixtures`, called by
  `_fetch` *after* `beforeRequest` runs. The seam exists because replicating
  D91's load-bearing method/body re-stamping outside the adapter module would
  drift; `/fixtures` therefore imports the same implementation it intercepts.
- `PuzzleApp.prototype.mount` is wrapped to run the config's optional
  `setup(app)` at beforeMount timing (after the user's own hook, before
  navigation #0 — the D66 seeding window).
- `installFixtures` returns `uninstall()`, matching the
  `installFakeAnimate`/`installFakeObserver` convention, for test isolation.
- **Typings**: the subpath ships `types/fixtures.d.ts` (the parallel of D94's
  `types/testing.d.ts`), and because `seed()`/`resetFixtureSeed()` are added
  to `Store.prototype` only at install time, they reach the `Store` type via
  **module augmentation** in that file — importing `/fixtures` is what makes
  `store.seed()` type-check; core's Store declaration stays clean.

**Compiler.** `puzzle dev --fixtures` / `puzzle build --fixtures` wire the
app's `app/fixtures.js` (convention; `.ts` allowed; missing file is a clear
error). The flag generates a two-module wrapper entry under
`<root>/.puzzle/fixtures/` — the same generated-entry mechanism the `--static`
mode already uses — and swaps `EntryPoints`:

```js
// wiring.js — a DEPENDENCY module, so its body runs before the app entry
import { installFixtures } from '@magic-spells/puzzle/fixtures';
import config from '<abs>/app/fixtures.js';
installFixtures(config);
// app.js (wrapper — keeps the dist/app.js output name)
import './wiring.js';
import '<abs>/app/app.js';
```

Two modules, not one: static imports hoist, so the install call must live in a
dependency's body to execute before the real entry constructs and mounts the
app. Without the flag, nothing references the module — it cannot be bundled
**by construction**, with any compiler version. `--fixtures` with
`--static`/`--hybrid` is rejected: a prerender pass runs the app in Node at
build time, so an installed fixtures module would bake generated records into
the shipped HTML.

**The app fixtures file** is the one place all fake-data config lives:

```js
export default {
  seed: 42,                                      // optional PRNG seed
  mock: { todos: { latency: [100, 400], data: […] } }, // per type
  async setup(app) { app.store.seed('todos', 10); },   // before navigation #0
};
```

**Mock config resolution** (Cory-confirmed): merged per type,
`{ ...Model.adapter?.mock, ...config.mock?.[type] }`, active when either side
exists. `static adapter.mock` keeps working (D95 shape, tests survive) for
quick knobs like `latency`; heavy `data` arrays belong in the fixtures file so
they never ship without the flag. With no flag a model-declared mock is inert
data and requests hit the real endpoint — that is the *documented meaning* of
not passing `--fixtures`. D96's refuse-throw is deleted: an explicit flag
cannot be "wrong" the way a heuristic scan could, so there is no compiled-out
state to defend against.

## Consequences

- `store.js` carries no adapter seam; `/fixtures` explicitly installs the `/adapter` capability
  before capturing `_network`. `app.js` loses
  the `fixtureSeed` plumbing (the seed now rides `installFixtures({ seed })` /
  the fixtures file). All 13 probes, both defines, the scan tokens, and the
  three "compiled out" error messages are gone.
- Production/dev bundles without the flag carry zero fixture bytes regardless
  of compiler version — the stale-binary class of bug is structurally
  impossible. The pre-D157 measurement on `examples/todos` was: plain build
  62560 raw / 20414 gzip (Release-1 baseline was 62506 / 20394, so the then-core
  cost was the ~54-byte seam; the D96 state was 63317 / 20702, so D98 also recovered
  the stub/probe residue). `--fixtures` build: 70599 / 23439 with the demo
  `app/fixtures.js`, engine markers present, `.puzzle/` cleaned up after.
- **The generated wrapper imports must be pinned side-effectful.** The package
  ships `"sideEffects": false`, so esbuild dropped both bare wrapper imports
  and emitted an empty 32-byte bundle; the fixtures resolver plugin returns
  `SideEffects: true` for exactly those two specifiers. Found by a failing
  test during implementation — the hazard is unique to the wrapper because a
  normal entry point is never tree-shaken.
- The dev/real-API switch Cory asked for falls out: `puzzle dev` against the
  real server, `puzzle dev --fixtures` against fakes, `puzzle build
  --fixtures` for a shareable preview with baked-in data.
- Watch mode simplifies: the flag is constant per process, so none of D96's
  define-staleness rebuild logic applies to fixtures/mock (it remains for
  flip/head-tags, which still scan per rebuild).
- Vitest needs no compiler: tests import `installFixtures` directly and pair
  it with `uninstall()` per test.
- The wrapper lives in the shared `.puzzle/` scratch directory
  ([[DECISION-D153-PUZZLE-SCRATCH-DIR]]), which the usage scan prunes as a
  dot-dir. A one-shot build removes the wrapper only when that build created
  `.puzzle/` itself: a `puzzle dev --fixtures` session in the same app root
  keeps its generated entry alive for the process lifetime, and a build that
  deleted it out from under that session would break every later rebuild.

## Alternatives rejected

- **Keeping D96's scan/defines** — the two hazards above are structural, and
  the 154-line core footprint plus shipped stub messages contradict the
  pay-for-what-you-use posture the mechanism was built to serve.
- **Pure userland install (no flag)** — the author imports and calls
  `installFixtures` in their own entry; but then *excluding* it from
  production becomes their problem again (hand-rolled env guards), which is
  D96's failure mode relocated. The flag makes inclusion an explicit build
  input.
- **Gating on `__PUZZLE_DEV__`** — already rejected in D96 for making a mock
  behave differently under `dev` and `build`; also cannot express Cory's
  preview-build case (`build --fixtures`).
- **A single wrapper module** — import hoisting would evaluate the app entry
  before the install call; the two-module shape is what guarantees ordering
  under plain ESM semantics.
- **Mock config exclusively in the fixtures file** — cleanest end state but
  breaks the D95 declaration 34 tests and the docs use, and a model-local
  `latency` knob is legitimately convenient; the per-key merge gets both.
- **A `dev: { fixtures: true }` config key** — deferred, CLI-only for now;
  a config default would blur the explicit-switch semantics Cory wants until
  there's a proven need.
