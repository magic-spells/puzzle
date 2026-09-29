---
name: Development guide
status: built
connections:
  - DOC-SPEC
  - DOC-RELEASE-SURFACE
  - DOC-TESTING
  - FLOW-BUILD
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
  - DOC-STRESS-EXAMPLE
---

# Development guide

Contributor guidance for `packages/puzzle`. [[DOC-SPEC]] is the contract, the
decision cards are the rationale, [[DOC-RELEASE-SURFACE]] is the shipped
inventory, and [[DOC-ARCHITECTURE]] has the repository map. The parser is the
sibling Go module `packages/puzzle-lang` (imported through a
`replace => ../puzzle-lang`); pieces, devtools, eslint and prettier are
sibling packages with their own installs and lockfiles.

## Prerequisites

Go at the version `go.mod` names (1.24), a current Node.js with npm (CI uses
22), Tailwind dependencies for Tailwind examples, and Playwright browsers only
for browser tests. `npm test` shells out to the Go compiler, so Go is needed
for the JavaScript workflow too.

## Commands

```sh
npx vitest run
(cd compiler && go test ./...)
(cd ../puzzle-lang && go test ./...)
npm test                      # pretest builds fixtures and example apps, then Vitest
npm run test:types
npm run verify:pack
npm run test:e2e-pack
npm run test:browser
npm run bench                 # production benchmark; not a gate (see below)
```

Golden codegen fixtures live in `compiler/internal/codegen/testdata/`;
regenerate with `go test ./internal/codegen -update` and review the diff —
never update goldens to silence a failure. `npm run build` at this root is an
alias for release prep (cross-compiles binaries, packs a tarball), not a
framework build.

`npm run bench` ([[DECISION-D128-BENCHMARK-METHODOLOGY]]) builds a scratch
copy of [[DOC-STRESS-EXAMPLE]] in production, drives a fixed op matrix, and
reports medians against `benchmarks/baseline.json`. Its exit code depends only
on structural counters and validation, never on timing. Read
`benchmarks/README.md` before quoting a number.

## Continuous integration

`.github/workflows/ci.yml` at the monorepo root runs on push and pull request
for `main` and `release/**`: **go** (vet, build, test), **windows** (the same Go
steps plus a scaffold-and-build smoke with a fresh `puzzle.exe`), **js**
(`npm test`, `verify:pack`, `test:types`), **e2e-pack**, **browser**
(Playwright chromium + webkit), and **pieces**, **devtools**, **plugins** (the
sibling suites against this tree). There is no Windows JS job — the runtime is
platform-independent — and no publish job; releasing is by hand
([[FLOW-RELEASE]]). CI is a backstop; run the suites yourself.

## CLI behavior worth knowing

- `puzzle build` is production by default; `--mode development`, `--static`,
  `--hybrid`, `--fixtures`, `--profile-build`.
- `puzzle dev` builds, watches, rebuilds incrementally and sends
  state-preserving SSE reloads. It serves per output mode: the SPA loop with
  history fallback, or for `output: 'static'` the real static pipeline on each
  rebuild (warm, route-scoped), with the reload client injected only at serve
  time.
- `puzzle preview` serves a built `dist/` like a production host — no
  watcher, injection or `dev.proxy` — on port 4000 by default. Both scan for a
  free port unless `--strict-port`.
- Config is `puzzle.config.js`, loaded by Node; Go never parses JavaScript.
  Tailwind is the only style pipeline; Sass is intentionally unsupported.

## Working conventions

1. Read the connected cards before changing a covered area and update them in
   the same work; bind load-bearing source through FILE cards.
2. `<script>` is real JavaScript (D3); TypeScript is transpile-only. To prove
   a block parses, extract it to `.mjs` and run `node --check`.
3. Define `events` as arrow-function class fields so handlers keep the
   instance.
4. Call template library entries functions — never filters or pipes;
   `formatters` survives only as the config key and in registry code names.
5. Keep `examples/todos/` and the relevant focused examples aligned with the
   public docs.
6. Label unshipped ideas as future or rejected.
7. A [[DOC-SPEC]] amendment needs a decision card: a new question gets the
   next number; a changed answer rewrites its existing card in place.
8. Contract changes move with their docs, tests, examples and cards.
