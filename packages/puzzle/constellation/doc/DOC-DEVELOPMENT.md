---
name: Development guide
status: verified
connections:
  - DOC-SPEC
  - DOC-SPEC-BUILD
  - DOC-RELEASE-SURFACE
  - DOC-ARCHITECTURE
  - DOC-TESTING
  - FLOW-BUILD
  - FLOW-RELEASE
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - DOC-STRESS-EXAMPLE
  - DECISION-D128-BENCHMARK-METHODOLOGY
verified_at: '2026-11-01T19:26:04.240Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# Development guide

Contributor guidance for `packages/puzzle`. [[DOC-SPEC]] is the contract, the decision
cards are the rationale, [[DOC-RELEASE-SURFACE]] is the shipped inventory, and
[[DOC-ARCHITECTURE]] has the repository map. The parser is the sibling Go module
`packages/puzzle-lang` (imported through a `replace => ../puzzle-lang`); pieces, devtools,
eslint and prettier are sibling packages with their own installs and lockfiles (no npm
workspaces — editing a dependency means regenerating that package's lockfile).

## Prerequisites

Go at the version `go.mod` names, a current Node.js with npm (CI uses 22), Tailwind
dependencies for Tailwind examples, and Playwright browsers only for browser tests.
`npm test` shells out to the Go compiler, so Go is needed for the JavaScript workflow too.

## Commands

```sh
npx vitest run
npm run test:runtime-types    # runtime JSDoc + published .d.ts drift
(cd compiler && go test ./...)
(cd ../puzzle-lang && go test ./...)
npm test                      # pretest builds fixture and example apps, then Vitest
npm run test:types
npm run verify:pack
npm run test:e2e-pack
npm run test:browser
npm run build:compiler        # ./puzzle from this tree
npm run bench                 # production benchmark; not a gate (see below)
```

Golden codegen fixtures live in `compiler/internal/codegen/testdata/`; regenerate with
`go test ./internal/codegen -update` and review the diff — never update goldens to silence
a failure. **`npm run build` is an alias for release prep** (cross-compiles five binaries,
packs a tarball), not a framework build. The runtime stays JavaScript: when
`test:runtime-types` trips, fix the JSDoc or `types/*.d.ts`, never the code.

`npm run bench` ([[DECISION-D128-BENCHMARK-METHODOLOGY]]) builds a scratch copy of
[[DOC-STRESS-EXAMPLE]] in production, drives a fixed op matrix, and reports medians
against `benchmarks/baseline.json`. Its exit code depends only on structural counters and
validation, never on timing. Read `benchmarks/README.md` before quoting a number.

## Continuous integration

`.github/workflows/ci.yml` at the monorepo root runs on push and pull request for `main`
and `release/**`: **go** (vet, build, test for both modules, plus a `GOOS=js GOARCH=wasm`
build of `cmd/pzl-wasm`), **windows** (the Go steps plus a scaffold-and-build smoke with a
fresh `puzzle.exe`), **js** (`npm test`, `verify:pack`, `test:types`,
`test:runtime-types`), **e2e-pack**, **browser** (Playwright chromium + webkit), and
**pieces**, **devtools**, **plugins** (the sibling suites against this tree). There is no
publish job; releasing is by hand ([[FLOW-RELEASE]]). CI is a backstop; run the suites
yourself.

## CLI behavior worth knowing

The full CLI contract is [[DOC-SPEC-BUILD]] §13. For day-to-day work: `puzzle build` is
production by default and content-hashes names (`build.hashNames: false` keeps
`app.js`/`styles.css`); `puzzle dev` serves the SPA loop, or the real static pipeline for
`output: 'static'`; `puzzle preview` serves a built `dist/` like a production host on port
4000. Config is `puzzle.config.js`, loaded by Node — Go never parses JavaScript. Tailwind
is the only style pipeline; Sass is intentionally unsupported. Smoke-testing the npm pieces
transport needs `PUZZLE_PIECES_REGISTRY` unset (the maintainer's shell sets it).

## Working conventions

1. Read the connected cards before changing a covered area and update them in the same
   work; bind load-bearing source through FILE cards.
2. `<script>` is real JavaScript (D3); TypeScript is transpile-only. To prove a block
   parses, extract it to `.mjs` and run `node --check`.
3. Define `events` as arrow-function class fields so handlers keep the instance.
4. Call template library entries functions — never filters or pipes; `formatters`
   survives only as the config key and in registry code names.
5. Keep `examples/todos/` and the relevant focused examples aligned with the public docs.
6. Label unshipped ideas as future or rejected.
7. A [[DOC-SPEC]] change needs a decision card: a new question gets the next number; a
   changed answer rewrites its existing card in place.
8. Contract changes move with their docs, tests, examples and cards.
