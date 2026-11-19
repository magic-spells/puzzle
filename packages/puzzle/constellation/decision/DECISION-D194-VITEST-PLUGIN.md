---
name: D194 — the Vitest plugin and the scaffolded test suite
status: built
connections:
  - DOC-TESTING
  - DOC-SPEC-BUILD
  - DOC-USER-GUIDE
  - DOC-RELEASE-SURFACE
  - COMPONENT-TESTING
  - COMPONENT-COMPILER-CLI
  - DECISION-D94-TESTING-EXPORT
  - DECISION-D54-TYPESCRIPT-SCRIPTS
  - DECISION-D75-IMPORT-ALIAS
  - FILE-VITEST-PLUGIN
  - FILE-STANDALONE-COMPILE
---

## Context

`/testing` (D94) gave app authors `mountView`, `createTestApp` and `settled()`, but an app had no way to run them on its own components. Vitest runs on Vite, and Vite cannot read a `.pzl` file: the compiler is the Go binary, reached only through `puzzle build`/`dev`. The framework's own suite gets around this by compiling fixtures ahead of time with the internal `pzlc` tool, which an app does not have. So `import Counter from '../app/components/Counter.pzl'` in an app's test failed, and `puzzle init` created no test, no test script and no hint that testing was possible.

## Decision

- **`@magic-spells/puzzle/vitest`** exports `puzzle(options?)`, a Vite plugin for `vitest.config.js`. Its `transform` hook hands each `.pzl` module to `puzzle compile <file>` and serves the printed module. Its `config` hook adds the build's always-on `@/` → `<root>/app/` alias (SPEC §40), so test imports resolve as app imports do.
- **The plugin runs the installed binary through the package's own bin shim** (`node bin/puzzle.js compile <file>`), so platform resolution and its error message stay in one place. `options.bin`, then `PUZZLE_BIN`, names an executable to run directly instead (a compiler built from source).
- **`puzzle compile <file.pzl>` is a hidden CLI command** that prints one standalone module to stdout: the D20 directory rule picks view or component mode, `{#svg}` inlines from the nearest `app/assets/`, a `lang="ts"` script has its types stripped, and `<style>` blocks are dropped. Errors are positioned `file:line:col: message` on stderr with exit 1. It shares `internal/standalone` with `pzlc`, so the framework's fixtures and an app's tests compile through the same code. It is hidden because the plugin is its only intended caller.
- **Vitest's on-disk module cache** (`fsModuleCache`, keyed on source text) is kept honest through `configureVitest`: a `.pzl` module's key includes `puzzle@<version>`; a `.pzl` that inlines `{#svg}`, or any `.pzl` compiled by a custom binary, is not cached. Vitest versions without the hook skip it.
- **`puzzle init` scaffolds a suite.** Every template gets `vitest.config.js` (the plugin plus `environment: 'jsdom'`), a `"test": "vitest run"` script, and `vitest` + `jsdom` dev dependencies. `default` gets `tests/Counter.test.js`, a component test that clicks the counter; `todos` gets `tests/Home.test.js` (add a todo through the form) and `tests/todo.test.js` (a store test on the model). The `--typescript` overlay ports each test to `.test.ts` and adds `tests/**/*.ts` to the strict `tsconfig.json`, so editors type-check tests; `puzzle check` still checks only `app/`. The default `Counter.pzl` gains a `count` class on its number so the test has a stable selector.

## Alternatives rejected

- **Compile through the WASM core (D164) inside the plugin.** No process per file, but a 6 MB artifact the npm package does not ship, and a second compile path to keep in step with the binary.
- **A long-lived `puzzle compile --serve` process.** Faster for large suites, but a protocol and process lifecycle for a cost (one short process per `.pzl`, cached by Vitest across runs) nobody has hit yet. It can come later behind the same plugin API.
- **Have `puzzle build` emit compiled modules for tests.** A build step before every test run, and stale output whenever it is skipped.
- **Make `puzzle compile` a documented command.** Its output is a test-time artifact, not something to build on, and `puzzle build` is the real compile.
- **Put tests next to components.** One `tests/` folder outside `app/` keeps test code out of the app tree the build and `puzzle check` walk, and is easy to find on day one. Vitest finds `*.test.*` files anywhere, so an app can still colocate.

## Consequences

A new app's `npm test` passes out of the box, and `/testing` is visible from the first minute. `release:prep` and the scaffold tests are unaffected by the new dev dependencies (the release sweep still covers only `@magic-spells/puzzle` ranges). The template's `vitest`/`jsdom` ranges need the same occasional bump as its Tailwind ranges. `.pzl` files inside `node_modules` are not compiled: Vitest externalizes dependencies, and pieces are copied into `app/` anyway.
