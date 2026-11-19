---
name: vitest plugin entry
status: built
path: client-runtime/vitest/index.js
language: javascript
summary: >-
  Published ./vitest entry: puzzle(), the Vite plugin that compiles .pzl imports in an
  app's Vitest suite through `puzzle compile`.
connections:
  - DECISION-D194-VITEST-PLUGIN
  - COMPONENT-TESTING
  - FILE-STANDALONE-COMPILE
---

# vitest/index.js

The published `@magic-spells/puzzle/vitest` entry ([[DECISION-D194-VITEST-PLUGIN]]). Node-only tooling that runs in Vitest's process; nothing in the runtime imports it. `puzzle()` returns a `pre` Vite plugin: `config` adds the `@/` → `<root>/app/` alias, `transform` runs `puzzle compile <file>` (through `bin/puzzle.js`, or the `bin` option / `PUZZLE_BIN` executable) and serves its stdout, rejecting with the compiler's positioned stderr on failure and passing warnings to `this.warn`. `configureVitest` keys Vitest's `fsModuleCache` for `.pzl` modules to the package version and opts out `{#svg}` users and custom binaries. Its `node:` imports are shimmed for the runtime type check in `tests-types/runtime/env.d.ts`; behavior is covered by `tests/vitest-plugin.test.js` with a stand-in executable.
