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

The section splitter is a direct port of the Puzzle language module's
`packages/puzzle-lang/parser/sections.go` (and its `lexskip.go` / `scan.go`
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

  // Wire the Puzzle processor onto every .pzl file, mark components rendered
  // as template tags as used, and relax a couple of whitespace/BOM rules on
  // the extracted virtual files.
  ...puzzle.configs.recommended,

  // Any extra rules you want on the <script> body:
  {
    files: ['**/*.pzl/*_scripts.js'],
    rules: {
      semi: ['error', 'always'],
    },
  },
];
```

Target the extracted block with `**/*.pzl/*_scripts.js` (or
`**/*.pzl/*_scripts.{js,ts}` alongside a TS parser entry). A `**/*.pzl`
pattern matches only the outer file, never the extracted `<script>` block, so
rules scoped to it never reach your code.

### Components used as template tags

An import the `<script>` body only uses as a template tag
(`import Card from './Card.pzl'` rendered as `<Card>`) is a real use, so
`recommended` enables `puzzle/uses-template-components`, which marks every
component tag in `<puzzle-view>` and `<puzzle-skeleton>` as used — like
`react/jsx-uses-vars` — and never reports anything itself. A component tag is
any tag whose name does not start with an ASCII lowercase letter (`<Card>`,
`<Élan>`, `<_Row>`); a family tag (`<Frame.Header>`) marks its root, `Frame`.
Only markup counts: a tag written inside an HTML or template comment, a
`{#raw}` block, an attribute value or a string in `{ … }` is not a use.
Template expressions (`{ title }`) read view data, never `<script>` bindings,
so a `const` referenced only inside `{ … }` is still reported as unused.

### TypeScript (`<script lang="ts">`)

The processor names a TypeScript block `*.pzl/0_scripts.ts`. `recommended`
covers only the JS blocks, because a TS block needs a TS parser: without one,
ESLint would parse it as JavaScript and stop with a fatal error, so
`recommended` leaves TS blocks unlinted. Add `puzzle.configs.typescript` after
your TypeScript config to lint them with the same setup the JS blocks get
(`puzzle/uses-template-components` on, the whitespace/BOM rules off):

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import puzzle from '@magic-spells/eslint-plugin-puzzle';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...puzzle.configs.recommended,
  puzzle.configs.typescript,
];
```

`puzzle.configs.typescript` is a single entry (no spread) for
`**/*.pzl/*_scripts.ts`, and it sets **no parser**: it relies on the config
before it to parse those files as TypeScript, which
`tseslint.configs.recommended` does for every file. If you wire the parser
yourself instead, put a parser entry before it:

```js
export default [
  ...puzzle.configs.recommended,
  {
    files: ['**/*.pzl/*_scripts.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // your TS rules
    },
  },
  puzzle.configs.typescript,
];
```

## Scope and limits

- **`<style>` linting is not handled here.** Use
  [stylelint](https://stylelint.io/) for CSS.
- **Template linting (`<puzzle-view>` / `<puzzle-skeleton>` markup) is future
  work.** This plugin lints the `<script>` body and validates section
  structure only; it does not lint the Puzzle template grammar. Every template
  construct splits correctly and passes through unjudged: dotted family tags
  (`<Frame.Header>`), the `\{` / `\}` brace escape, the `{#for}` range
  spellings, and every template expression (D176) — function calls
  (`title={ truncate(name.trim(), 20) }`), object-literal arguments
  (`{ t('cart.count', { count: items.length }) }`), arrow-function arguments
  (`{#for t in todos.filter(t => !t.done)}`), and template literals, including
  a `}` or `</puzzle-view>` inside one.
- **Template-language errors are the compiler's to report.** A template
  expression is a closed JavaScript-shaped grammar (D176): a method outside the
  method table (`items.sort()`), `this`, `new`, a bitwise operator such as `|`,
  a misplaced `raw()`, or a component name like `<Frame-x>` or `<Slot.Foo>` is
  a positioned `puzzle build` error. None of them produce an ESLint message
  here, and none of them stop the `<script>` body from being linted.
- `@event` handler values (`@click={ save(item.id) }`) are template
  expressions too; they live in template bytes, so ESLint does not see them.
- A `.pzl` file with no `<script>` section produces no JS blocks (but section
  errors are still reported).
- **Section-error columns count UTF-16 code units.** The compiler's splitter
  counts UTF-8 bytes, so on a line holding non-ASCII text (`café`, `金額`, an
  emoji) a section error from this plugin and the same error from
  `puzzle build` name the same line but different columns. Both only occur on
  a file that already fails to compile.

## License

MIT
