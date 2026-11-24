---
name: vitest plugin entry
status: verified
path: client-runtime/vitest/index.js
language: javascript
summary: >-
  Published ./vitest entry: puzzle(), the Vite plugin that compiles .pzl imports in an
  app's Vitest suite through `puzzle compile`.
connections:
  - DECISION-D194-VITEST-PLUGIN
  - COMPONENT-TESTING
  - FILE-STANDALONE-COMPILE
verified_at: '2026-11-24T18:02:16.140Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

# vitest/index.js

The published `@magic-spells/puzzle/vitest` entry ([[DECISION-D194-VITEST-PLUGIN]]). Node-only tooling that runs in Vitest's process; nothing in the runtime imports it. `puzzle()` returns a `pre` Vite plugin: `config` adds the `@/` → `<root>/app/` alias, `transform` runs `puzzle compile <file>` (through `bin/puzzle.js`, or the `bin` option / `PUZZLE_BIN` executable) and serves its stdout, rejecting with the compiler's positioned stderr on failure and passing warnings to `this.warn`. Vite drops inline source maps, so `transform` hands a `lang="ts"` module's inline map to Vite as the module's map; with it, an error thrown in a `.pzl` script names its `.pzl` line. `configureVitest` keys Vitest's `fsModuleCache` for `.pzl` modules to the package version and opts out `{#svg}` users and custom binaries. Its `node:` imports are shimmed for the runtime type check in `tests-types/runtime/env.d.ts`; behavior is covered by `tests/vitest-plugin.test.js` with a stand-in executable.
