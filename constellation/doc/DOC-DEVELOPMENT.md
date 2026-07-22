---
name: Development guide
status: verified
verified_at: '2026-07-22T00:04:05.541Z'
connections:
  - DOC-SPEC
  - DOC-DECISIONS
  - DOC-RELEASE-SURFACE
  - DOC-TESTING
  - DOC-BUILD-PLAN
  - FLOW-BUILD
  - COMPONENT-DEV-SERVER
  - COMPONENT-COMPILER-CLI
---

# Development guide

Contributor guidance for the current repository. [[DOC-SPEC]] is the frozen
contract; [[DOC-DECISIONS]] is the rationale index; [[DOC-RELEASE-SURFACE]] is
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
```

`npm test` first recompiles generated fixture modules and smoke-builds the
blog, grimoire, typed-todos, virtual-scroll, and slot-forwarding fixtures before
running Vitest. Go is therefore required for the JavaScript test workflow.

Golden codegen fixtures live in `compiler/internal/codegen/testdata/`.
Regenerate intentionally with:

```sh
go test ./internal/codegen -update
```

Review generated diffs; never update goldens merely to silence a failure.

## CLI development

`puzzle build [dir]` creates a production bundle by default.
`--mode development` keeps readable output, and `--static` enables
prerendered route pages. `puzzle dev [dir]` performs an initial build, serves
`dist/` with SPA fallback, watches recursively, rebuilds incrementally, and
broadcasts state-preserving SSE reloads after successful builds.

Configuration is loaded from `puzzle.config.js` by Node; Go does not parse
JavaScript. Tailwind is the supported style pipeline. Sass is intentionally not
supported. See [[FLOW-BUILD]] for build guarantees and failure behavior.

## Working conventions

1. Read the connected Constellation cards before changing a covered area and
   update them in the same work. Connect load-bearing source through FILE cards.
2. Treat `<scripts>` as real JavaScript (D3). TypeScript mode transpiles syntax
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
