---
name: Testing strategy
status: built
connections:
  - DOC-DEVELOPMENT
  - DOC-SPEC
  - FLOW-BUILD
  - FLOW-REACTIVITY
  - TEST-TODOS-INTEGRATION
---

# Testing strategy

Puzzle verifies each contract at the narrowest useful layer, then repeats
critical paths end to end. Never quote test counts; the suite output is the
truth. Two audiences: the framework's own suites (below), and the shipped
`/testing` surface for app authors (last section). Never point app authors at
`tests/helpers/` — it is internal.

## Required suites

```sh
npx vitest run
npm run test:runtime-types             # runtime JSDoc + published .d.ts drift
(cd compiler && go test ./...)
(cd ../puzzle-lang && go test ./...)   # the parser is its own Go module
```

All four pass before any work is called complete. `npm test` adds a pretest
that compiles the generated fixtures and smoke-builds the example apps it
depends on; use it when a change touches build integration or examples.

- **Vitest/jsdom** covers app lifecycle, view state, patching, events,
  functions, store/model, routing, transitions, scroll, animations, morph,
  i18n, dev-state transfer and the static serializer. The todos behavior suite
  runs against both handwritten fixtures and modules compiled by the real Go
  compiler, which catches compiler/runtime calling-convention drift.
- **Go** table tests cover section splitting, parsing, the expression
  grammar, codegen, plugin resolution, config/styles, staged builds, public
  assets, watching, CLI commands, scaffolds/generators/pieces, and prerender.
  Golden files pair `.pzl` input with expected JavaScript; regenerate only
  deliberately with `go test ./internal/codegen -update` (from `compiler/`)
  and review the diff.
- **Runtime types** (`test:runtime-types`, CI's JS job, and `release:prep`
  step 2.6). The runtime stays plain JavaScript with no build step; TypeScript
  7 checks it from its JSDoc and the published `types/*.d.ts` are held to it.
  Two programs:
  - `tsconfig.runtime.json` — `allowJs` + `checkJs` over `client-runtime/`,
    with `noImplicitAny` and every other strict-family flag except
    `strictNullChecks` (~180 errors, nearly all "possibly null" reads guarded
    by runtime invariants; clearing them would take a JSDoc cast per site for
    little signal). Type-only support lives in `tests-types/runtime/`:
    `env.d.ts` (the `__PUZZLE_*__` build flags, `window` hooks, two `node:`
    shims for the SSG, the untyped morph-engine peer), `augment.d.ts` (members
    installed by `defineProperty`, stamped on by another module, or declared
    by the author's subclass) and `installed.d.ts` (the adapter/fixtures Store
    members, OPTIONAL so core code cannot assume them).
  - `tests-types/drift` — strict, `allowJs` without `checkJs`. For every
    package export it fails on a runtime value export the `.d.ts` does not
    declare, a declared value the runtime does not export, and a runtime value
    not ASSIGNABLE to its declaration (one way: a declaration may be narrower —
    generics, literal unions, brands — never promise more). Parameters compare
    bivariantly (`strictFunctionTypes` off) because runtime classes carry `#`
    private fields and are nominal; arity and returns stay strict. It models
    everything installed (`drift/installed.d.ts`), matching the published
    augmentations. Deliberate gaps are named with a reason in `drift.ts`:
    the adapter module's test seams (`STORE_RAW`, `serializeReadState`,
    `hydrateReadState`) and `mountView`'s shape (its generic constraint names
    the published vs the runtime `PuzzleView`).
  A runtime edit that trips either program is fixed in JSDoc (or in
  `types/*.d.ts` when the contract changed) — never by changing code.
  Production bundles are unaffected by JSDoc (esbuild strips comments when
  minifying); development bundles keep some inline `/** @type */` comments.

Also, in proportion to the change and all of them for a release candidate:
`npm run test:types` (public declarations against a strict consumer),
`npm run verify:pack` (tarball contents and metadata), `npm run test:e2e-pack`
(packed install into a clean consumer), `npm run test:browser` (Playwright).

## Test design rules

- Test public behavior and durable invariants, not implementation trivia.
- Keep parser/codegen positions and error text actionable.
- Every shipped grammar construct needs parser and emission proof.
- Every reactive fix needs a test that crosses the real subscription/render
  boundary.
- Failure-path tests assert last-good output/state survives where the contract
  promises atomicity.
- Rejected features may have negative boundary tests; never implement a second
  spec in tests.
- Generated fixtures are build products, never hand-edited.

## Testing a Puzzle app (the shipped surface)

App authors import `@magic-spells/puzzle/testing` (D94):

```js
import { mountView, createTestApp, settled, type, measureRenders,
  installFakeAnimate, installFakeObserver, installFixtures }
  from '@magic-spells/puzzle/testing';

const view = await mountView(TodoList, { props: { filter: 'open' }, store });
await view.click('.toggle');
await view.type('.title', 'walk the dog');

const app = await createTestApp({ routes, models, routerInitialPath: '/todos/42' });
await settled();
```

- `mountView` mounts one view into a detached container; the handle has
  `element`, `find`, `findAll`, `click`, `type`, `setProps`, `destroy`.
- `createTestApp` boots a real app in memory routing (it imports
  `memoryRouter()` itself and consumes `routerInitialPath`), so `visit()`
  drives the real load-then-commit pipeline, guards and lifecycle. An `i18n`
  option wires translations over an in-memory table and restores the locale
  afterwards.
- `settled()` drains stores, scheduled `setData` renders and last-wins
  `data()`/navigation promises to a fixed point. It is bounded
  (`{ maxPasses }`) and throws naming the churn source instead of hanging. It
  does not advance user timers or skeleton `min-duration`, resolve promises
  `data()` never awaited, fire IntersectionObserver callbacks, or finish
  fire-and-forget enter animations.
- `type(target, text)` sets the value, dispatches `input` and `change`, then
  settles — the way to drive two-way bindings. It throws on a checkbox or
  radio; use `click()`.
- `measureRenders(handle, fn)` returns a frozen report of useful/wasted
  renders, DOM mutations, per-view causes, depth and store notifications.
- `installFakeAnimate` / `installFakeObserver` supply the WAAPI and
  IntersectionObserver jsdom lacks; each returns `uninstall()`.
- `installFixtures({ seed })` (D98) attaches `store.seed(type, n)` and the mock
  adapter, which serves adapter verbs offline from a model's
  `static adapter = { endpoint, mock: { latency, failRate, fail } }` or the
  install config; latency and failure knobs are how skeleton timing and
  `data()` rejection get exercised. In a running app `--fixtures` wires the
  same module from `app/fixtures.js`; without the flag none of it is bundled.

`tests/testing-todos.test.js` ports canonical todos behavior onto these public
helpers. Keep it that way — it is what catches the public API rotting relative
to the internal one.
