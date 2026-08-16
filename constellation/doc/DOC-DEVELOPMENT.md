---
name: Development guide
status: verified
verified_at: '2026-08-16T04:35:12.224Z'
connections:
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
  - DOC-TESTING
  - DOC-BUILD-PLAN
  - FLOW-BUILD
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - DOC-STRESS-EXAMPLE
verified_sha: 9c955bc1f77a97a0a6af37f80822820f4ca31adb
---

# Development guide

Contributor guidance for the current repository. [[DOC-SPEC]] is the frozen
contract; the decision cards are the rationale record; [[DOC-RELEASE-SURFACE]] is
the compact shipped-surface map.

## Repository map

| Path | Purpose |
| --- | --- |
| `client-runtime/` | Browser runtime, optional morph entry, static serializer, formatter registry, and development-state transfer. |
| `compiler/` | Go parser/codegen, build orchestration, esbuild plugin, dev server, config/styles, CLI, scaffolds, generators, pieces, and prerender runner. |
| `types/` | Public TypeScript declarations. |
| `bin/`, `npm/` | Root CLI shim and optional platform binary packages. |
| `examples/todos/` | Canonical integration application. |
| `examples/` | Focused acceptance and showcase apps for the wider surface. |
| `tests/`, `tests-types/` | Vitest/jsdom integration tests and public type assertions. |
| `constellation/` | Durable architecture, decisions, features, files, flows, and release planning for future agents. |

The Go module is rooted at the repository `go.mod`. Node package metadata and
test orchestration are rooted at `package.json`.

## Prerequisites

- Go 1.21 or newer
- Node.js 20 or newer
- npm
- Tailwind dependencies when working on Tailwind-enabled examples
- Playwright browsers only for browser-suite work

## Common commands



```sh
npx vitest run
go test ./...                 # run from compiler/ per repository convention
npm run test:types
npm run verify:pack
npm run test:e2e-pack
npm run test:browser
npm run bench                 # production performance benchmark; see below
```

`npm test` first recompiles generated fixture modules and smoke-builds the
blog, grimoire, typed-todos, virtual-scroll, slot-forwarding, and two-way
binding fixtures before running Vitest. Go is therefore required for the
JavaScript test workflow.

`npm run bench` is the production performance harness in `benchmarks/`
([[DECISION-D128-BENCHMARK-METHODOLOGY]]). It is **not** part of the required
suites and **not** a CI gate: it builds a scratch copy of the
[[DOC-STRESS-EXAMPLE]] app in production mode, drives it through a fixed op
matrix, and reports medians against `benchmarks/baseline.json`. Its exit code
depends only on structural counters and validation, never on timing — a timing
delta under ~13% on the machine of record is noise. `npm run bench:update`
rewrites the baseline; `benchmarks/probe.mjs` is the development-build companion
for the counters production compiles out, and `probe-route-churn.mjs` /
`probe-listener-churn.mjs` are the scenario-specific probe scripts it runs. Read
`benchmarks/README.md` before quoting any number from it.

### Continuous integration

`.github/workflows/ci.yml` runs four parallel jobs: **go** (`go vet`,
`go build`, `go test` over `./...`), **js** (`npm test`, `npm run verify:pack`,
`npm run test:types`), **e2e-pack** (`npm run test:e2e-pack`), and **browser**
(a Playwright chromium + webkit smoke via `npm run test:browser`). Three of the
four install Go as well as Node, because `npm test`'s pretest, the packed-tarball
build, and Playwright's example dev servers all shell out to the real compiler.

**It triggers only on push and pull_request against `main`.** Day-to-day work
happens on `release/*` and `feat/*` branches, and a PR from a feature branch
into a release branch never targets `main` — so the normal workflow gets **zero
CI coverage** and the local suites are the only gate until a release branch
merges to `main`. Run both required suites yourself; do not wait for a green
check that will not appear.

There is no publish workflow. Releases are packed and published by hand.

Golden codegen fixtures live in `compiler/internal/codegen/testdata/`.
Regenerate intentionally with:

```sh
go test ./internal/codegen -update
```

Review generated diffs; never update goldens merely to silence a failure.

## CLI development



`puzzle build [dir]` creates a production bundle by default.
`--mode development` keeps readable output; `--static` emits true static pages
(no router or `app.js`, per-page mount modules) and `--hybrid` emits prerendered
pages plus the SPA bundle the router takes over (D67/D81). `--fixtures` wires
the fixtures module in, and `--profile-build` prints the per-phase timings.

`puzzle dev [dir]` performs an initial build, watches recursively, rebuilds
incrementally, and broadcasts state-preserving SSE reloads after successful
builds. What it *serves* follows the resolved output mode (D148): a plain or
`hybrid` project gets the SPA loop with history fallback, while an
`output: 'static'` project gets the real static pipeline on every rebuild —
clean URLs, full page loads, a real 404, and the live-reload client injected at
serve time so `dist/` on disk stays production-clean. Those static rebuilds are
warm (D154) and render only the routes a save can reach (D155).

`puzzle preview [dir]` serves an already-built `dist/` the way a production
host will, per output mode, with no watcher, no SSE, no injection, and no
`dev.proxy`. It defaults to port 4000 so it runs beside `dev`. Both commands
scan upward for a free port unless `--strict-port` is given (D90).

Configuration is loaded from `puzzle.config.js` by Node; Go does not parse
JavaScript. Tailwind is the supported style pipeline. Sass is intentionally not
supported. See [[FLOW-BUILD]] for build guarantees and failure behavior.

## Working conventions

1. Read the connected Constellation cards before changing a covered area and
   update them in the same work. Connect load-bearing source through FILE cards.
2. Treat `<script>` as real JavaScript (D3). TypeScript mode transpiles syntax
   but does not type-check component bodies. To prove a block parses, extract it
   to a `.mjs` file and run `node --check` on it.
3. Define `events` as arrow-function class fields so handlers retain the
   component instance.
4. Say “formatters,” never the retired “filters” API name.
5. Keep `examples/todos/` and the relevant focused examples aligned with
   public documentation.
6. Label genuinely unshipped ideas as future or rejected. Do not describe
   already-shipped amendments as deferred.
7. Any [[DOC-SPEC]] amendment requires the next numbered DECISION card.
8. Preserve focused commits; contract changes move with their docs, tests,
   examples, and Constellation cards.

Before claiming success, run both required suites exactly as documented in the
repository agent guidance.
