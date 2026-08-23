# Puzzle monorepo — agent guide

This is the monorepo root; the root `package.json` is a **private shell** that
publishes nothing. The framework and everything releasing in lockstep with it
live under `packages/` (decision D162):

- `packages/puzzle` — the framework (`@magic-spells/puzzle`): runtime, Go
  compiler, CLI, examples, release scripts, and the project constellation.
  **Read `packages/puzzle/CLAUDE.md` before any framework work** — it is the
  operating guide, and the constellation under `packages/puzzle/constellation/`
  is the source of truth (constellation MCP: pass `repo=packages/puzzle`;
  pieces' own constellation is `repo=packages/puzzle-pieces`).
- `packages/puzzle-pieces` — the pieces registry (npm, version == framework).
- `packages/puzzle-devtools` — the Chrome extension (`private: true`, ships as
  a zip; its framework dep is `file:../puzzle`, so its suite runs against the
  working tree).
- `packages/puzzle-eslint` / `packages/puzzle-prettier` — the lint/format
  plugins; both vendor JS ports of the compiler's section splitter/lexer that
  must track grammar changes.

Repo-wide rules that do not move:

- Release branches are the working trunk; feature branches PR into
  `release/x.y.z`. **Never create version tags, never publish to npm, never
  merge release branches into `main`** — Cory does all three.
- There are deliberately **no npm workspaces**: each package keeps its own
  install and lockfile. Editing any package.json dependency means regenerating
  that package's lockfile, or its `npm ci` hard-fails.
- Every package in the release train carries the framework version;
  `release:prep` (run in `packages/puzzle`) asserts all the stamps.
- The three editor grammars (puzzle-vscode/sublime/zed) are separate repos by
  design — sweep them when the template grammar changes.
- Root scripts (`npm test`, `npm run release:prep`, …) delegate to
  `packages/puzzle`; run package-specific work inside each package.
