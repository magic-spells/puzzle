---
name: Testing strategy
status: verified
verified_at: '2026-07-22T00:04:06.191Z'
connections:
  - DOC-DEVELOPMENT
  - DOC-BUILD-PLAN
  - DOC-SPEC
  - FLOW-BUILD
  - FLOW-REACTIVITY
  - TEST-TODOS-INTEGRATION
---

# Testing strategy

Puzzle verifies contracts at the narrowest useful layer, then repeats critical
paths end to end. Avoid fixed test counts in documentation; the suite output is
the source of truth.

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
