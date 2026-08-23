# Puzzle monorepo

**[Puzzle](packages/puzzle)** is an SPA-first JavaScript framework — single-file
`.pzl` components, reactive `data()` views, and a Go + esbuild compiler. Start
with the [framework README](packages/puzzle/README.md).

Everything that releases in lockstep with the framework lives here:

| Package | What it is | Ships as |
|---|---|---|
| [`packages/puzzle`](packages/puzzle) | The framework: runtime, compiler, CLI, examples | `@magic-spells/puzzle` on npm |
| [`packages/puzzle-pieces`](packages/puzzle-pieces) | Copy-in UI component registry for `puzzle add piece` | `@magic-spells/puzzle-pieces` on npm |
| [`packages/puzzle-devtools`](packages/puzzle-devtools) | Chrome DevTools extension | extension zip (never npm) |
| [`packages/puzzle-eslint`](packages/puzzle-eslint) | ESLint plugin for `.pzl` files | `@magic-spells/eslint-plugin-puzzle` (not yet published) |
| [`packages/puzzle-prettier`](packages/puzzle-prettier) | Prettier 3 plugin for `.pzl` files | `@magic-spells/prettier-plugin-puzzle` (not yet published) |

Every package in the release train carries the framework's version. Editor
grammars ([vscode](https://github.com/magic-spells/puzzle-vscode),
[sublime](https://github.com/magic-spells/puzzle-sublime),
[zed](https://github.com/magic-spells/puzzle-zed)) live in their own repos —
their distribution channels are repo-shaped.

```bash
cd packages/puzzle
npm install && npm test          # framework suite
npm run build:compiler           # emits ./puzzle, the CLI the other packages build with
```

Preview the component library at
[magicspells.io/puzzle-pieces](https://magicspells.io/puzzle-pieces).

MIT © Magic Spells
