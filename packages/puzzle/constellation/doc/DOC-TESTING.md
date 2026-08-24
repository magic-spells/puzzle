---
name: Testing strategy
status: verified
verified_at: '2026-08-24T21:11:50.859Z'
connections:
  - DOC-DEVELOPMENT
  - DOC-BUILD-PLAN
  - DOC-SPEC
  - FLOW-BUILD
  - FLOW-REACTIVITY
  - TEST-TODOS-INTEGRATION
verified_sha: b1a8642a73e5584ab1e44f807164c93017857db0
notes:
  - kind: verified
    text: >-
      Baseline re-stamped after the monorepo move (290e4b7) relocated the framework to
      packages/puzzle. Every bound file is byte-identical between the prior verified_sha and this
      one — the path moved, the code did not. No content was re-checked, and none needed to be.
    sha: b1a8642a73e5584ab1e44f807164c93017857db0
---

# Testing strategy

Puzzle verifies contracts at the narrowest useful layer, then repeats critical
paths end to end. Avoid fixed test counts in documentation; the suite output is
the source of truth.

**Two audiences.** Everything below covers testing **the framework** — the
suites a contributor runs before claiming work complete. Testing **an app built
with Puzzle** is a separate, shipped surface (see the last section). Never point
app authors at `tests/helpers/`; those are internal and unpublished.

## Required release suites

```sh
npx vitest run
cd compiler
go test ./...
```

Both must pass before claiming repository work complete.

## JavaScript coverage

Vitest/jsdom covers application lifecycle, component state, vnode patching,
events, formatters, store/model behavior, routing/transitions/scroll,
animations, morph integration, development-state transfer, and the static
serializer.

The todos behavior suite runs against both handwritten fixtures and modules
compiled by the real Go compiler. This detects mismatches between compiler
emission and runtime calling conventions.

`npm test` is the broader local workflow: its pretest compiles generated
fixtures and smoke-builds representative example apps before Vitest. Use it
when changes touch build integration or examples.

## Go coverage

Table-driven tests cover section scanning, template parsing, expression/code
generation, plugin resolution, config/styles, build staging, public assets,
watch behavior, CLI commands, scaffolds/generators/pieces, and prerender
orchestration.

Golden tests pair `.pzl` input with expected JavaScript. Update them only with
the explicit flag and review the generated diff:

```sh
go test ./internal/codegen -update
```

## Additional release checks

```sh
npm run test:types
npm run verify:pack
npm run test:e2e-pack
npm run test:browser
```

- Type tests protect the public declaration surface.
- Pack verification checks root/platform tarball contents and metadata.
- E2E pack testing installs the packed artifacts into a clean consumer project.
- Playwright covers behavior that requires a real browser.

Run these in proportion to the changed surface and all of them for the final
release candidate.

## Test design rules

- Test public behavior and durable internal invariants, not implementation
  trivia.
- Keep parser/codegen positions and error text actionable.
- Every shipped grammar construct needs parser and emission proof.
- Every reactive fix needs at least one test that crosses the actual
  subscription/render boundary.
- Failure-path tests must assert last-good output/state remains intact where the
  contract promises atomicity.
- Rejected features may have negative boundary tests; do not accidentally
  implement a second spec in tests.
- Generated fixtures are build products, never hand-edited expectations.

## Testing a Puzzle app (the shipped surface)



App authors do **not** use anything in `tests/helpers/`. They import
`@magic-spells/puzzle/testing` (D94, SPEC §53):

```js
import {
  mountView,
  createTestApp,
  settled,
  type,
  measureRenders,
  installFakeAnimate,
  installFakeObserver,
}
  from '@magic-spells/puzzle/testing';

const view = await mountView(TodoList, { props: { filter: 'open' }, store });
await view.click('.toggle');
await view.type('.title', 'walk the dog');

const app = await createTestApp({ routes, models });
await app.visit('/todos/42');
await settled();

const profile = await measureRenders(view, () => view.click('.toggle'));
```

- `mountView` mounts one view against a detached container; the handle exposes
  `element`/`find`/`findAll`/`click`/`type`/`setProps`/`destroy`.
- `createTestApp` runs a real app in memory mode, so `visit()` drives the real
  load-then-commit pipeline, guards, and lifecycle. It imports the D159
  `memoryRouter()` factory itself, so a test never wires a router mode; a
  `routerInitialPath` in the config is consumed by the helper.
- **`settled()` is the piece that matters.** It drains stores, rAF-scheduled
  `setData` renders, and last-wins `data()`/navigation promises to a fixed point.
  It is bounded (`settled({ maxPasses })`) and **throws** naming the churn source
  rather than hanging, so a `data()` → store-write → `data()` cycle is diagnosed
  instead of surfacing as a runner timeout.
- **Know its non-guarantees** — it does not advance user timers or skeleton
  `min-duration` holds, resolve promises `data()` never awaited, fire
  IntersectionObserver callbacks, or finish fire-and-forget enter animations.
- `type(target, text)` sets the value and dispatches the bubbling `input` and
  `change` events a real edit-then-leave produces, then settles — the way to
  drive D147 two-way bindings from a test. It takes a selector or an element
  (the mounted handles expose it as `handle.type(...)`) and **throws** on a
  checkbox or radio, which have no text value; toggle those with `click()`.
- `measureRenders(handle, callback)` temporarily observes actual
  `ViewManager.render` entries, awaits the callback and `settled()`, and returns
  a deeply frozen report covering useful/wasted renders, DOM mutations,
  per-view/cause counts, recursive depth, and Store notifications. It is
  runner-neutral and counts no coalesced-away `refresh()` request as a render.
- `installFakeAnimate` / `installFakeObserver` supply the WAAPI and
  IntersectionObserver jsdom lacks; each returns `uninstall()`.

For data, install the self-contained fixtures module first (D98, SPEC §52) —
`const uninstall = installFixtures({ seed })` in setup, `uninstall()` in
teardown (it is re-exported from `/testing`). Installing attaches
`store.seed(type, n)` (schema-derived fixtures) and the mock adapter, which
serves the adapter verbs offline from
`static adapter = { endpoint, mock: { latency, failRate, fail } }`
and/or the install config's per-type `mock` entries — the
latency and failure knobs are how skeleton timing and `data()`-rejection paths
get exercised at all. In a running app the same module is wired by `puzzle dev
--fixtures` / `puzzle build --fixtures` from `app/fixtures.js` (SPEC §54);
without the flag none of it is bundled.

**The framework's own suite dogfoods this surface.** `tests/testing-todos.test.js`
ports canonical todos behavior onto the public helpers; keep it that way, because
it is the only thing that catches the public API rotting relative to the
internal one.
