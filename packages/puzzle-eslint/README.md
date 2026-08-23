# @magic-spells/eslint-plugin-puzzle

ESLint plugin for [Puzzle Framework](https://github.com/magic-spells/puzzle)
`.pzl` single-file components. It lets your existing ESLint rules lint the
`<script>` body of a `.pzl` file as real JavaScript / TypeScript, and it
validates the file's section structure.

ESLint **>= 9, flat config only**.

## What it does

A `.pzl` file is not JavaScript. It is up to four top-level sections in any
order — `<puzzle-view>` (required), `<puzzle-skeleton>`, `<script>`, and
`<style>`. Only the `<script>` body is real code (JS, or TS with
`lang="ts"`), byte-for-byte.

This plugin is a **processor**, not a new parser:

- It extracts the `<script>` body into one virtual file
  (`your-file.pzl/0_scripts.js` or `.ts`) and hands it to ESLint, so every rule
  you already run — and any parser you layer on — applies to it unchanged.
- The virtual file is the original source with everything outside the
  `<script>` body blanked to spaces (newlines preserved), so reported
  line/column positions **and autofix ranges** land exactly on the real file.
  Autofixes only ever touch bytes inside `<script>`.
- It validates section structure and reports problems (missing `<puzzle-view>`,
  duplicate sections, illegal section attributes, a `<script>`/`<style>` body
  truncated by a stray close tag, stray top-level content) as ESLint messages
  under the rule id `puzzle/no-invalid-sections`.

The section splitter is a direct port of the Puzzle compiler's
`compiler/internal/parser/sections.go` (and its `lexskip.go` / `scan.go`
helpers), so it carves sections and finds close tags exactly the way the real
compiler does — a literal `</script>` inside a string, template literal,
comment, or regex will **not** truncate the body.

## Install

```sh
npm install --save-dev @magic-spells/eslint-plugin-puzzle eslint
```

## Usage (flat config)

The `recommended` config only wires up the processor — you still bring your own
JavaScript rules. A typical `eslint.config.js`:

```js
import js from '@eslint/js';
import puzzle from '@magic-spells/eslint-plugin-puzzle';

export default [
  // Your normal JS config. Because it is not restricted with `files`, it also
  // applies to the virtual `*.pzl/0_scripts.js` files the processor emits.
  js.configs.recommended,

  // Wire the Puzzle processor onto every .pzl file, and relax a couple of
  // whitespace/BOM rules on the extracted virtual files.
  ...puzzle.configs.recommended,

  // Any extra rules you want on the <script> body:
  {
    files: ['**/*.pzl'],
    rules: {
      semi: ['error', 'always'],
    },
  },
];
```

### TypeScript (`<script lang="ts">`)

For `.pzl` files whose script sections are TypeScript, layer `@typescript-eslint` on the
virtual `.ts` files the processor emits:

```js
import tseslint from 'typescript-eslint';
import puzzle from '@magic-spells/eslint-plugin-puzzle';

export default [
  ...puzzle.configs.recommended,
  {
    // The processor names TS blocks `*.pzl/0_scripts.ts`.
    files: ['**/*.pzl/*_scripts.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // your TS rules
    },
  },
];
```

## Scope and limits

- **`<style>` linting is not handled here.** Use
  [stylelint](https://stylelint.io/) for CSS.
- **Template linting (`<puzzle-view>` / `<puzzle-skeleton>` markup) is future
  work.** This plugin lints the `<script>` body and validates section
  structure only; it does not yet lint the Puzzle template grammar.
- A `.pzl` file with no `<script>` section produces no JS blocks (but section
  errors are still reported).

## License

MIT
