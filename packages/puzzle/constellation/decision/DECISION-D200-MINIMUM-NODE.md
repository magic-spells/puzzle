---
name: D200 — Node 24 is the minimum; CI tests Node 24 and Node 26
status: built
connections:
  - DOC-RELEASE-SURFACE
  - DOC-DEVELOPMENT
  - DOC-TESTING
  - COMPONENT-COMPILER-CLI
  - DECISION-D162-MONOREPO-PACKAGES
  - DECISION-D165-PUZZLE-CHECK
---

# D200 — Node 24 is the minimum; CI tests Node 24 and Node 26

Puzzle needs Node 24 or later. `@magic-spells/puzzle`, `@magic-spells/puzzle-pieces`, `@magic-spells/eslint-plugin-puzzle` and `@magic-spells/prettier-plugin-puzzle` declare `"engines": { "node": ">=24" }`, and each lockfile's root entry mirrors it. CI runs the framework's `js` job on Node 24 and Node 26, and every other job on Node 26.

## Context

Node runs the `puzzle` shim (`bin/puzzle.js`), `puzzle.config.js`, prerendering for `output: 'hybrid'` and `output: 'static'`, `puzzle check`'s `tsc` (D165), the `/vitest` plugin, every test suite, and the lint/format plugins. Puzzle is a new framework and can require a current runtime. Cory (2026-11-20): "we don't need to worry about Node 22 support. We can move up to 24 or 26. This is a new framework and we can require people to use NEW technologies".

## Decision

- **The floor is Node 24**, a long-term-support line that deploy hosts already offer, so a Puzzle app deploys without waiting for its host to add a runtime.
- **Declared in `engines`** on the four public packages that run on Node — not on the private DevTools packages, and not on the five platform packages, which hold only the Go binary. On an older Node, npm warns `EBADENGINE` at install (an error under `engine-strict`). Nothing checks the version at runtime.
- **CI covers both ends.** The `js` job (`npm test`, `verify:pack`, `test:types`, `test:runtime-types`) runs a matrix of Node 24, the floor, and Node 26, the current long-term-support line. The Go, Windows, e2e-pack, browser, pieces, devtools and plugins jobs run Node 26.
- **Node 25 and later define a global `localStorage`**, undefined unless Node starts with `--localstorage-file`, and Vitest's jsdom environment keeps a global that already exists, so jsdom's working Storage is hidden. `tests/setup.js` puts `jsdom.window.localStorage` back on `globalThis` for every jsdom suite.

## Alternatives rejected

- **Node 26 only** — the current line, but not yet offered by every deploy host, and Puzzle uses nothing that 26 adds over 24.
- **Keeping Node 22** — one more line to test, for no feature Puzzle needs from it.

## Consequences

- Code may use anything Node 24 ships, with no fallback for older lines.
- Raising the floor means changing the four `engines` fields (then `npm install --package-lock-only` in each package), the `js` matrix, the README and plugin READMEs, the agent skill's CLI line, [[DOC-DEVELOPMENT]] (Prerequisites), [[DOC-RELEASE-SURFACE]] (Package), and this card.
